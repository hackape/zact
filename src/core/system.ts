import type { ActorRef } from './types'
import { toSystemMessage, EXIT } from './systemMessage'
import * as __internal__ from './internal'
import { invariant, ErrorCode, ErrorMessage } from './invariant'

// global functions:
export function send(target: ActorRef, msg: any) {
  target.send(msg)
  return msg
}

export function self() {
  return __internal__.currentProc().pid
}

export function stash(msg: any) {
  __internal__.currentProc().mailbox.stash(msg)
}

export function unstashAll(filter?: (msg: any) => boolean) {
  __internal__.currentProc().mailbox.unstashAll(filter)
}

export function parent() {
  return __internal__.currentProc()?.parent?.pid
}

export function exit(reason: any): never {
  Process.exit(self(), reason)
  throw `Exit with reason: ${reason}`
}

export module Process {
  export function list() {
    return __internal__.listProcs()
  }

  export function flag(option: 'trapExit', value: boolean) {
    const actor = __internal__.currentProc()
    invariant(actor, ErrorCode.InvalidCall, ErrorMessage.InvalidCall)
    invariant(
      option !== 'trapExit' || typeof value !== 'boolean',
      ErrorCode.ArgumentError,
      'currently `Process.flag(option, value)` only takes `option="trapExit" and `value=boolean`'
    )
    actor.trapExit = value
  }

  export function onTerminate(ref: ActorRef, disposable: () => void) {
    const actor = __internal__.getProcByActorRef(ref)
    if (!actor) return false
    return actor.onTerminate(disposable)
  }

  export function alive(ref: ActorRef) {
    return __internal__.isAlive(ref)
  }

  export function exit(dest: ActorRef, reason: any) {
    const sender = self()
    const msg = toSystemMessage(sender, { type: EXIT, sender, data: reason })
    send(dest, msg)
    return true
  }

  export function link(ref: ActorRef) {
    const parent = __internal__.currentProc()
    invariant(parent, ErrorCode.InvalidCall, ErrorMessage.InvalidCall)

    const child = __internal__.getProcByActorRef(ref)
    invariant(child, ErrorCode.NoProc, ErrorMessage.NoProc)

    // link to self, noop
    if (child === parent) return true

    parent._links.add(ref)
    child!._links.add(parent.pid)
    return true
  }

  export function unlink(ref: ActorRef) {
    const parent = __internal__.currentProc()
    parent?._links.delete(ref)

    const child = __internal__.getProcByActorRef(ref)
    child?._links.delete(parent?.pid)
    return true // always return true
  }

  export function monitor(ref: ActorRef) {
    const parent = __internal__.currentProc()
    invariant(parent, ErrorCode.InvalidCall, ErrorMessage.InvalidCall)

    const monRefId = __internal__.getRefId()
    const child = __internal__.getProcByActorRef(ref)
    if (!child) return monRefId // child is dead, return ref anyway

    parent._monitors.set(monRefId, ref)
    if (!child._monitoredBy.has(parent.pid)) {
      child._monitoredBy.set(parent.pid, new Set())
    }
    child._monitoredBy.get(parent.pid)!.add(monRefId)
    return monRefId
  }

  export function demonitor(monRefId: number) {
    const parent = __internal__.currentProc()
    invariant(parent, ErrorCode.InvalidCall, ErrorMessage.InvalidCall)

    const childActorRef = parent._monitors.get(monRefId)
    // if target monitor is not found
    if (!childActorRef) return false

    const child = __internal__.getProcByActorRef(childActorRef)
    // even if child is already dead, still success
    child?._monitoredBy.delete(parent.pid)
    return true
  }
}
