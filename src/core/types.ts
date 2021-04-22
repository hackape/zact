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
  after?(timeout: number, fallback: () => any): Receiver
  canHandle?(msg: any): boolean
  timeout?: number
  fallback?(): any
}
