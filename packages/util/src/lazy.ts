export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  return (): T => {
    if (loaded) return value as T
    loaded = true
    value = fn()
    return value as T
  }
}

export function lazyAsync<T>(fn: () => T | Promise<T>) {
  let value: T | undefined
  let loaded = false
  let initPromise: Promise<T> | undefined

  const result = (): T | Promise<T> => {
    if (loaded) return value as T
    if (initPromise) return initPromise
    initPromise = Promise.resolve(fn()).then((v) => {
      value = v
      loaded = true
      initPromise = undefined
      return v
    })
    return initPromise
  }

  return result
}
