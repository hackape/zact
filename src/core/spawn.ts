import type { ActorRef } from './types'
import { Actor } from './actor'

type AnyFunction = (...args: any[]) => any
export function spawn<F extends AnyFunction>(fn: F, options?: SpawnOpts): ActorRef
export function spawn<F extends AnyFunction>(fn: F, args: Parameters<F>, options?: SpawnOpts): ActorRef
export function spawn(m: any, f: string, a: any[], options?: SpawnOpts): ActorRef
export function spawn(...args: any[]): ActorRef {
  const mfao = normalizeSpawnArgs(args)

  const actor = new Actor(...mfao)
  const actorRef = actor.pid

  // pull the trigger
  actor.start()

  return actorRef
}

const _opts = {}
function normalizeSpawnArgs(args: any[]): MFAO {
  const last = args[args.length - 1]
  const lastIsArgsList = Array.isArray(last)
  switch (args.length) {
    case 1: // [F]
      return [args[0], '', [], _opts]
    case 2: {
      if (lastIsArgsList) {
        // [F, A]
        return [args[0], '', args[1], _opts]
      } else {
        // [F, O]
        return [args[0], '', [], args[1]]
      }
    }
    case 3: {
      if (lastIsArgsList) {
        // [M, F, A]
        return [args[0], args[1], args[2], _opts]
      } else {
        // [F, A, O]
        return [args[0], '', args[1], args[2]]
      }
    }
    default: {
      return [args[0], args[1], args[2], args[3]]
    }
  }
}

type SpawnOpts = {
  link?: boolean
  monitor?: boolean
}

type MFAO = [object | Function, string, any[], SpawnOpts]
