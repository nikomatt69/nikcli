export namespace Env {
  function backing(): Record<string, string | undefined> {
    // SAFETY: Node's `ProcessEnv` is this index signature plus a handful of
    // declared well-known keys; the assertion only drops those extras.
    return process.env as Record<string, string | undefined>
  }

  export function get(key: string) {
    return backing()[key]
  }

  export function all() {
    return backing()
  }

  export function set(key: string, value: string) {
    backing()[key] = value
  }

  export function remove(key: string) {
    delete backing()[key]
  }
}
