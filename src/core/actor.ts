import * as __internal__ from './internal'
import { send, Process } from './system'
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

// TODO: http://erlang.org/doc//man/sys.html
// TODO: http://erlang.org/doc//man/sys.html#handle_system_msg-6

enum ActorStatus {
  INIT = 0,
  WAITING = 1,
  RUNNING = 2,
  DONE = 3,
}

type SpawnOpts = {
  link?: boolean
  monitor?: boolean
}

export type ActorRef = {
  send(msg: any): any
  _pid: number
}

export class Actor<M = any> {
  pid: ActorRef
  mailbox = new Mailbox<M>()
  receive: (msg: any, meta: any) => any
  parent: Actor
  trapExit: boolean

  private initializer: () => any
  private status = ActorStatus.INIT

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

  constructor(module: any, func: string, args: any[], options: SpawnOpts) {
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

    const newable = Boolean(module && module?.prototype?.constructor === module)
    const callable = typeof module === 'function'
    this.initializer = () => {
      // upon entering, unset `this.receive, this.initializer`
      // @ts-ignore
      this.receive = this.initializer = null
      // module is function
      if (callable) {
        const receiver = newable ? new module(...args) : module(...args)
        if (!receiver) return
        if (typeof receiver === 'function') return receiver
        if (typeof receiver[func] === 'function') {
          // TODO: think about the API for class base module
          return receiver[func].bind(receiver)
        }
        throw Error(`Cannot find function \`${func}\` in module`)
      }
    }
  }

  start() {
    // start by setting initializer as the first receiver
    // and send a `null` message to trigger coroutine
    this.status = ActorStatus.WAITING
    this.receive = this.initializer
    this.send(null)
  }

  send(msg: any) {
    if (isSystemMessage(msg)) {
      // currently support only ExitSignal
      // if `trapExit`, ExitSignal MAY be unpack and re-route to mailbox
      this.onReceiveExitSignal(msg[2])
      return msg
    } else {
      this.mailbox.enqueue(msg)
      if (this._monitors.size && msg?.[0] === DOWN) {
        // once DOWN message is delivered
        // should remove record from `_monitors`
        const downSignal = msg as DownSignal
        const monRefId = downSignal[1]
        this._monitors.delete(monRefId)
      }
      this.next()
      return msg
    }
  }

  stash(msg: any) {
    this.mailbox.stash(msg)
  }

  unstashAll(filter?: (item: M) => boolean) {
    this.mailbox.unstashAll(filter)
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

  _args = new Array(1)
  private getCoroutineArgs() {
    this._args[0] = this.mailbox.dequeue()
    return this._args
  }

  private coroutine(args: any[]) {
    try {
      return __internal__.provide(this, () => this.receive.apply(null, args))
    } catch (err) {
      return { type: EXIT, sender: this.pid, data: err } as ExitSignal
    }
  }

  next(_continue?: boolean, _sig?: any) {
    if (!_continue) {
      if (this.status > ActorStatus.WAITING) return
      if (!this.mailbox.length) return
    }

    // mark busy
    this.status = ActorStatus.RUNNING
    // execute coroutine
    const ret = _continue ? _sig : this.coroutine(this.getCoroutineArgs())
    // handle coroutine signal
    const [nextStatus, sig] = this.handleCoroutineReturnValue(ret)
    if (nextStatus === ActorStatus.DONE) {
      // done
      this.onReceiveExitSignal(sig)
    } else {
      this.status = nextStatus
    }

    // continue to process remaining msg in the mailbox
    this.next()
  }

  // return `true` means `this.idle = true`
  // release lock, can process next message
  private handleCoroutineReturnValue(sig: any): [ActorStatus, any] {
    // 0. undefined, reuse the current receiver
    if (sig === undefined && this.receive) {
      return [ActorStatus.WAITING, sig]
    }
    // 1. change behavior, ("become" in akka, "recur on self" in elixir)
    if (typeof sig === 'function') {
      this.receive = sig
      return [ActorStatus.WAITING, sig]
    }
    // 2. promise
    if (isThenable(sig)) {
      sig.then(
        sig => {
          this.next(true, sig)
        },
        err => {
          const sig: ExitSignal = { type: EXIT, sender: this.pid, data: err }
          this.next(true, sig)
        }
      )
      return [ActorStatus.RUNNING, sig]
    }

    // 3. handle coroutine error
    if (sig && sig.type === EXIT) {
      return [ActorStatus.DONE, sig]
    }

    const exitSig: ExitSignal = { type: EXIT, sender: this.pid, data: NORMAL }
    return [ActorStatus.DONE, exitSig]
  }
}

class Mailbox<M = any> {
  private _buffer: Array<M> = []
  private _queue: Array<M> = []

  stash(item: M) {
    this._buffer.push(item)
  }

  unstashAll(filter?: (item: M) => boolean) {
    if (!this._buffer.length) return
    const buffer = typeof filter === 'function' ? this._buffer.filter(filter) : this._buffer.slice()
    this._buffer = []
    this._queue = buffer.concat(this._queue)
  }

  enqueue(item: M) {
    this._queue.push(item)
  }

  dequeue() {
    return this._queue.shift()
  }

  get length() {
    return this._queue.length
  }
}

function isThenable(t: any): t is Promise<any> {
  return typeof t?.then === 'function'
}
