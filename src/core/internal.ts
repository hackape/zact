import type { ActorRef } from './types'
import type { Actor } from './actor'

// stack that tracks the current proc
const procStack = [] as Actor[]

export function provide<T>(service: Actor, fn: (service: Actor) => T) {
  try {
    procStack.push(service)
    const result = fn(service)
    return result
  } finally {
    procStack.pop()
  }
}

export function consume<T>(fn: (service: Actor) => T) {
  return fn(procStack[procStack.length - 1])
}

export function currentProc(): Actor {
  return procStack[procStack.length - 1]
}

// procId / refId
let _refId = 0
export function getRefId() {
  return _refId++
}

let _procId = 0
export function getProcId() {
  return _procId++
}

const procLookupTable = new Map<number, Actor>()

export function listProcs() {
  return Array.from(procLookupTable.values())
}

export function isAlive(actorRef: ActorRef) {
  return actorRef ? procLookupTable.has(actorRef._pid) : false
}

export function registerProcId(pid: number, proc: Actor) {
  if (procLookupTable.has(pid)) {
    throw Error(`pid<${pid}> already exists`)
  } else {
    procLookupTable.set(pid, proc)
    return true
  }
}

export function unregisterProcId(pid: number) {
  return procLookupTable.delete(pid)
}

export function getProcByActorRef(actorRef: ActorRef) {
  return procLookupTable.get(actorRef?._pid)
}

export function createActorRef(proc: Actor | undefined) {
  const _pid = getProcId()
  const actorRef = Object.freeze({
    _pid,
    send: (msg: any) => {
      proc?.send(msg)
      return msg
    },
  })

  registerProcId(_pid, proc!)

  const invalidateActorRef = () => {
    unregisterProcId(_pid)
    proc = undefined
  }

  return [actorRef, invalidateActorRef] as const
}
