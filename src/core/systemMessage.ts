import type { ActorRef, Msg } from './types'

// TODO: http://erlang.org/doc//man/sys.html
// TODO: http://erlang.org/doc//man/sys.html#handle_system_msg-6

const __SYS__ = Symbol('system')

export function isSystemMessage(msg: any) {
  return msg?.[0] === __SYS__
}

export function toSystemMessage(sender: any, msg: Msg) {
  return [__SYS__, sender, msg]
}

export const EXIT = ':EXIT' as const
export const DOWN = ':DOWN' as const
export const NORMAL = ':normal' as const
export const KILL = ':kill' as const
/**
 * three flavor of exit signals
 * - normal [':EXIT', pid, ':normal']
 * - error [':EXIT', pid, reason]
 * - kill [':EXIT', pid, ':kill']
 */
export interface ExitSignal extends Msg {
  type: typeof EXIT
  sender: ActorRef
  data: any
}
export interface DownSignal extends Msg {
  type: typeof DOWN
  sender: ActorRef
  data: { mid: number; reason: any }
}
export function exitSignalToDownSignal(mid: number, sig: ExitSignal): DownSignal {
  return { type: DOWN, sender: sig.sender, data: { mid, reason: sig.data } }
}
