import { Receiver } from './types'
import { invariant, ErrorCode } from './invariant'

export class Mailbox<M = any> {
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

  find(predicate: (item: M) => boolean): [boolean, any] {
    try {
      const index = this._queue.findIndex(predicate)
      if (index !== -1) {
        return [true, this._queue.splice(index, 1)[0]]
      } else {
        return [false, undefined]
      }
    } catch (err) {
      return [false, err]
    }
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

export function isThenable(t: any): t is Promise<any> {
  return typeof t?.then === 'function'
}

export function isIterator(t: any): t is IterableIterator<any> {
  return t && t[Symbol.iterator] && t[Symbol.iterator]() === t
}

export function isAsyncIterator(t: any): t is AsyncIterableIterator<any> {
  return t && t[Symbol.asyncIterator] && t[Symbol.asyncIterator]() === t
}

export function isIterResult(t: any): t is IteratorResult<any> {
  return typeof t === 'object' && t.hasOwnProperty('value') && t.hasOwnProperty('done')
}

export function isConstructor(t: any): t is new (...args: any[]) => any {
  return Boolean(t && t?.prototype?.constructor === t)
  // try {
  //   Reflect.construct(String, [], t)
  //   return true
  // } catch (e) {
  //   return false
  // }
}

export function isFunction(t: any): t is (...args: any[]) => any {
  return typeof t === 'function'
}

type MessageHandler<M = any> = (msg: M) => any
export function receive<M = any>(handler: MessageHandler<M>): Receiver
export function receive<M>(patterns: { [messageType: string]: MessageHandler<M> }): Receiver
export function receive(handler) {
  let receiver: Receiver
  if (isFunction(handler)) {
    receiver = function receiver(msg) {
      return handler(msg)
    }

    receiver.canHandle = () => true
  } else if (typeof handler === 'object') {
    const keys = Object.keys(handler).filter(x => x)

    invariant(
      keys.every(key => isFunction(handler[key])),
      ErrorCode.ArgumentError,
      `patterns must be an object of key-value pairs, where key is message type and value is a function`
    )

    const [canHandleAll, msgTypes] = isFunction(handler['_'])
      ? [true, keys.filter(type => type !== '_')]
      : [false, keys]

    receiver = function receiver(msg) {
      const msgHandler = handler[msg?.type] ?? handler['_']
      return msgHandler?.(msg)
    }

    receiver.canHandle = msg => canHandleAll || msgTypes.includes(msg?.type)
  } else {
    const error = new Error(
      'bad arguments: arg to `receive()` must be a function, or an object of key-value pairs, where key is message type and value is a function'
    )
    error.name = ErrorCode.ArgumentError
    throw error
  }

  function after(timeout: number, fallback: () => any) {
    receiver.timeout = timeout
    receiver.fallback = fallback
    return receiver
  }

  receiver.after = after
  return receiver
}

export function waitAfter(ms: number, next: () => void) {
  const tid = setTimeout(next, ms)
  const cancel = () => clearTimeout(tid)
  return cancel
}

export function noop() {}
