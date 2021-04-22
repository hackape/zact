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

  pick(predicate: (item: M) => boolean) {
    const index = this._queue.findIndex(predicate)
    if (index !== -1) {
      return this._queue.splice(index, 1)[0]
    } else {
      return undefined
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
  return t && 'done' in t && 'value' in t
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

export function receive(patterns) {
  let msgTypes
  let fallback
  if (typeof patterns['_'] === 'function') {
    msgTypes = Object.keys(patterns).filter(type => type !== '_')
    fallback = patterns['_']
  } else {
    msgTypes = Object.keys(patterns)
  }

  function canHandle(msg) {
    return fallback || msgTypes.includes(msg?.type)
  }

  return {
    canHandle,
    next(msg) {
      const handler = patterns[msg?.type] ?? patterns['_']
      if (typeof handler === 'function') {
        return { value: handler(msg), done: true }
      }
    },
  }
}

export function waitAfter(ms: number, next: () => void) {
  const tid = setTimeout(next, ms)
  const cancel = () => clearTimeout(tid)
  return cancel
}

export function noop() {}
