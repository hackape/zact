import * as __internal__ from './internal'
import { send, Process } from './system'
import type { ActorRef, Receiver, SpawnOpts } from './types'
import {
  EXIT,
  KILL,
  NORMAL,
  DOWN,
  ExitSignal,
  DownSignal,
  exitSignalToDownSignal,
  isSystemMessage,
  toSystemMessage,
} from './systemMessage'
import {
  isFunction,
  isConstructor,
  isIterator,
  isAsyncIterator,
  isIterResult,
  isThenable,
  Mailbox,
  waitAfter,
  noop,
} from './utils'

enum ActorStatus {
  WAITING = 1,
  RUNNING = 2,
  CONTINUE = 3,
  DONE = 4,
}

export class Actor {
  pid: ActorRef
  mailbox = new Mailbox<any>()
  parent: Actor
  trapExit: boolean

  private status = ActorStatus.CONTINUE

  _links = new Set<ActorRef>()
  // propagate exit signal to linked procs
  private propagateToLink(sig: ExitSignal) {
    if (this._links?.size) {
      this._links.forEach(proc => send(proc, toSystemMessage(this.pid, sig)))
      this._links.clear()
    }
  }

  // unlike "link", multiple "monitors" can be created for the same pair of parent-child
  // self is monitoring other procs
  _monitors = new Map<number, ActorRef>() // monRefId -> actorRef
  // self is monitored by other procs
  _monitoredBy = new Map<ActorRef, Set<number>>() // actorRef -> Set<monRefId>
  // notify monitoring procs about termination
  private notifyMonitor(sig: ExitSignal) {
    if (this._monitoredBy?.size) {
      this._monitoredBy.forEach((monRefIdSet, actorRef) => {
        monRefIdSet.forEach(monRefId => {
          send(actorRef, exitSignalToDownSignal(monRefId, sig))
        })
      })
      this._monitoredBy.clear()
    }
  }

  private _toDispose = new Set<() => void>()
  private dispose() {
    this._toDispose.forEach(fn => fn())
    this._toDispose.clear()
  }
  onTerminate(fn: () => void) {
    if (this.status === ActorStatus.DONE) return false
    this._toDispose.add(fn)
    return true
  }

  private terminate(_sig: ExitSignal) {
    if (this.status === ActorStatus.DONE) {
      console.warn('Weird! Terminate twice!')
      return
    }

    this.status = ActorStatus.DONE
    // aftermath
    this.dispose()
    // ensure exitSig originates from self
    // convert reason :kill to :killed
    const sig: ExitSignal = { type: EXIT, sender: this.pid, data: _sig.data === KILL ? ':killed' : _sig.data }
    this.propagateToLink(sig)
    this.notifyMonitor(sig)

    // cleanup internal states
    if (this._monitors.size) {
      this._monitors.forEach(childRef => {
        const child = __internal__.getProcByActorRef(childRef)
        child?._monitoredBy.delete(this.pid)
      })
    }
    // expect internal states to be empty by now
  }

  private onReceiveExitSignal(sig: ExitSignal) {
    // send signal to parent
    const { sender: from, data: reason } = sig

    if (this.trapExit) {
      if (reason === KILL) {
        // :kill cannot be trapped
        this.terminate(sig)
      } else if (this.pid === from) {
        // TODO: self call exit cannot be trapped
        // need to review
        // `exit` and `Process.exit` is different in elixir
        this.terminate(sig)
      } else {
        // re-route to mailbox
        this.send(sig)
      }
    } else {
      // route to default exitSignal handling logic
      if (this.pid === from) {
        // exit sent from self, terminate
        this.terminate(sig)
      } else if (reason !== NORMAL) {
        // error exit from other pid, terminate
        this.terminate(sig)
      }
      // normal exit from other pid, do not die
    }
  }

  private module: any = null
  constructor(m: any, func: string, args: any[], options: SpawnOpts) {
    this.parent = __internal__.currentProc()

    const [actorRef, invalidateActorRef] = __internal__.createActorRef(this)
    this.onTerminate(invalidateActorRef)
    this.pid = actorRef

    if (options.link) {
      Process.link(this.pid)
    }

    if (options.monitor) {
      Process.monitor(this.pid)
    }

    const newable = isConstructor(m)
    const callable = isFunction(m)
    const initializer = () => {
      if (func) {
        if (newable) {
          const instance = new m(...args)
          if (!isFunction(instance[func])) throw Error(`Cannot find function \`${func}\` in module`)
          this.module = instance
          return { done: true, value: instance[func] }
        } else {
          if (!isFunction(m[func])) throw Error(`Cannot find function \`${func}\` in module`)
          return { done: true, value: m[func] }
        }
      } else {
        if (!callable) throw Error('Invalid argument')
        return { done: true, value: m(...args) }
      }
    }

    this.stack.push({ next: initializer })
  }

  start() {
    // start by setting initializer as the first receiver
    // and send a `null` message to trigger coroutine
    this.status = ActorStatus.CONTINUE
    this.next()
  }

  send(msg: any) {
    if (isSystemMessage(msg)) {
      // currently support only ExitSignal
      // if `trapExit`, ExitSignal MAY be unpack and re-route to mailbox
      this.onReceiveExitSignal(msg[2])
      return msg
    } else {
      this.mailbox.enqueue(msg)
      if (this._monitors.size && msg?.type === DOWN) {
        // once DOWN message is delivered
        // should remove record from `_monitors`
        const downSignal = msg as DownSignal
        const monRefId = downSignal.data.mid
        this._monitors.delete(monRefId)
      }
      this.next()
      return msg
    }
  }

  // =================
  // COROUTINE
  // =================

  private get top() {
    return this.stack[this.stack.length - 1]
  }
  private stack: Array<Iterator<any> | AsyncIterator<any>> = []
  private cancelReceiverTakedown: () => void = noop
  private receiver: Receiver | undefined

  private feedback: any
  private coroutine(arg: any) {
    try {
      return __internal__.provide(this, () => this.top.next(arg))
    } catch (err) {
      return { type: EXIT, sender: this.pid, data: err } as ExitSignal
    }
  }

  private handleMessage(msg: any) {
    try {
      return __internal__.provide(this, () => this.receiver!.call(this.module, msg))
    } catch (err) {
      return { type: EXIT, sender: this.pid, data: err } as ExitSignal
    }
  }

  next() {
    if (this.status === ActorStatus.DONE) return
    if (this.status === ActorStatus.RUNNING) return

    let ret: any
    if (this.status === ActorStatus.CONTINUE) {
      const arg = this.feedback
      this.feedback = undefined
      ret = this.coroutine(arg)
    } else if (this.status === ActorStatus.WAITING) {
      if (!this.receiver || this.mailbox.length === 0) return

      if (isFunction(this.receiver.canHandle)) {
        const msg = this.mailbox.pick(this.receiver.canHandle)
        // cannot handle any msg, keep waiting
        if (msg === undefined) return
        ret = this.handleMessage(msg)
        this.cancelReceiverTakedown()
        this.receiver = undefined // automatically take down after use
      } else {
        ret = this.handleMessage(this.mailbox.dequeue())
        this.cancelReceiverTakedown()
      }
    }

    // handle coroutine signal
    this.arbitrate(ret)
  }

  private arbitrate(sig: any) {
    if (this.status === ActorStatus.DONE) return

    if (isIterResult(sig)) {
      if (sig.done) this.stack.pop()
      return this.arbitrate(sig.value)
    }

    // change behavior, ("become" in akka, "recur on self" in elixir)
    if (isFunction(sig)) {
      this.status = ActorStatus.WAITING
      this.receiver = sig
      const ttl = this.receiver!.ttl
      if (typeof ttl === 'number' && ttl > 0) {
        const afterFn = isFunction(this.receiver!.fallback) ? this.receiver!.fallback : noop
        this.cancelReceiverTakedown = waitAfter(ttl, () => {
          if (this.status === ActorStatus.DONE) return
          // takedown receiver
          this.cancelReceiverTakedown = noop
          this.receiver = undefined
          const g = { next: () => ({ done: true, value: afterFn() }) }
          this.stack.push(g)
          this.status = ActorStatus.CONTINUE
          this.feedback = undefined
          return this.next()
        })
      }
      return this.next()
    }

    if (isAsyncIterator(sig) || isIterator(sig)) {
      this.stack.push(sig)
      this.status = ActorStatus.CONTINUE
      this.feedback = undefined
      return this.next()
    }

    // promise
    if (isThenable(sig)) {
      this.status = ActorStatus.RUNNING
      sig.then(
        ret => {
          this.arbitrate(ret)
        },
        err => {
          const sig: ExitSignal = { type: EXIT, sender: this.pid, data: err }
          this.terminate(sig)
        }
      )

      return
    }

    // 3. handle coroutine error
    if (sig && sig.type === EXIT) {
      return this.terminate(sig)
    }

    if (this.stack.length) {
      this.status = ActorStatus.CONTINUE
      this.feedback = sig
      return this.next()
    } else if (this.receiver) {
      this.status = ActorStatus.WAITING
      return this.next()
    } else {
      const exitSig: ExitSignal = { type: EXIT, sender: this.pid, data: NORMAL }
      return this.terminate(exitSig)
    }
  }
}
