declare module "react-native-sse" {
  export default class EventSource {
    constructor(url: string, options?: { headers?: Record<string, string> })
    addEventListener(type: string, listener: (event: any) => void): void
    removeAllEventListeners(): void
    close(): void
  }
}
