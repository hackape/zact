export enum ErrorCode {
  InvalidCall = 'InvalidCall',
  ArgumentError = 'ArgumentError',
  NoProc = 'NoProc',
}

export const ErrorMessage = {
  InvalidCall: 'zact functions can only be called inside spawned actor',
  ArgumentError: 'bad arguments',
  NoProc: "cannot find the process to link to, it's probably dead already",
}

export function invariant<T>(cond: T, name: string, message: string): cond is T {
  if (!cond) {
    const error = new Error(message)
    error.name = name
    throw error
  }
  return true
}
