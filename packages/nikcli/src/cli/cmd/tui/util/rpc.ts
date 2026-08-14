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
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }
    return {
      name: "Error",
      message: String(error),
    }
  }

  function deserializeError(input: { name?: string; message?: string; stack?: string }) {
    const error = new Error(input.message ?? "RPC request failed")
    error.name = input.name ?? "Error"
    error.stack = input.stack
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
