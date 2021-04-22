export type Msg = { type: string; sender?: ActorRef; data?: any }

export type SpawnOpts = {
  link?: boolean
  monitor?: boolean
}

export type ActorRef = {
  send(msg: any): any
  _pid: number
}

export type Receiver = {
  (msg: any): any
  canHandle?(msg: any): boolean
  ttl?: number
  fallback?(): any
}
