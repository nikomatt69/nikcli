export namespace Rpc {
  type Definition = {
    [method: string]: (input: any) => any
  }

  export function listen(rpc: Definition) {
    onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.request") {
        try {
          const result = await rpc[parsed.method](parsed.input)
          postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
        } catch (error) {
          postMessage(
            JSON.stringify({
              type: "rpc.error",
              error: serializeError(error),
              id: parsed.id,
            }),
          )
        }
      }
    }
  }

  function serializeError(error: unknown) {
    if (error instanceof Error) {
      // Carry the extra fields too. Effect's tagged errors keep the actual reason in one of them
      // — `UpgradeFailedError.stderr` is the whole message, while `.message` is empty — so
      // name/message/stack alone arrives on the other side as a failure with nothing to show.
      const { name: _n, message: _m, stack: _s, ...rest } = error as Error & Record<string, unknown>
      const data = JSON.parse(JSON.stringify(rest ?? {})) as Record<string, unknown>
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        data,
      }
    }
    return {
      name: "Error",
      message: String(error),
    }
  }

  /**
   * The receiver gets a plain `Error`: the class cannot cross a worker boundary, so `instanceof`
   * against the original type is always false there. Match on `name` and read `data` instead.
   */
  function deserializeError(input: { name?: string; message?: string; stack?: string; data?: unknown }) {
    const error = new Error(input.message ?? "RPC request failed")
    error.name = input.name ?? "Error"
    error.stack = input.stack
    if (input.data && typeof input.data === "object") Object.assign(error, input.data)
    return error
  }

  export function emit(event: string, data: unknown) {
    postMessage(JSON.stringify({ type: "rpc.event", event, data }))
  }

  export function client<T extends Definition>(target: {
    postMessage: (data: string) => void | null
    onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
  }) {
    const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
    const listeners = new Map<string, Set<(data: any) => void>>()
    let id = 0
    target.onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.result") {
        const request = pending.get(parsed.id)
        if (request) {
          request.resolve(parsed.result)
          pending.delete(parsed.id)
        }
      }
      if (parsed.type === "rpc.error") {
        const request = pending.get(parsed.id)
        if (request) {
          request.reject(deserializeError(parsed.error))
          pending.delete(parsed.id)
        }
      }
      if (parsed.type === "rpc.event") {
        const handlers = listeners.get(parsed.event)
        if (handlers) {
          for (const handler of handlers) {
            handler(parsed.data)
          }
        }
      }
    }
    return {
      call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
        const requestId = id++
        return new Promise((resolve, reject) => {
          pending.set(requestId, { resolve, reject })
          try {
            target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
          } catch (error) {
            pending.delete(requestId)
            reject(error)
          }
        })
      },
      on<Data>(event: string, handler: (data: Data) => void) {
        let handlers = listeners.get(event)
        if (!handlers) {
          handlers = new Set()
          listeners.set(event, handlers)
        }
        handlers.add(handler)
        return () => {
          handlers!.delete(handler)
        }
      },
      rejectPending(error: Error = new Error("RPC client disposed")) {
        for (const request of pending.values()) {
          request.reject(error)
        }
        pending.clear()
      },
    }
  }
}
