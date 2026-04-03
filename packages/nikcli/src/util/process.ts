export namespace Process {
  export class RunFailedError extends Error {
    readonly code: number
    readonly stdout: Buffer
    readonly stderr: Buffer

    constructor(message: string, opts: { code: number; stdout: Buffer; stderr: Buffer }) {
      super(message)
      this.name = "RunFailedError"
      this.code = opts.code
      this.stdout = opts.stdout
      this.stderr = opts.stderr
    }
  }
}
