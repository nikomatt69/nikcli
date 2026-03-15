import type { Config } from "../config"

export type Adaptor<T extends Config = Config> = {
  create(from: T, branch?: string | null, workspaceID?: string): Promise<{ config: T; init: () => Promise<void> }>
  remove(from: T): Promise<void>
  request(
    from: T,
    method: string,
    url: string,
    data?: BodyInit,
    signal?: AbortSignal,
    headers?: HeadersInit,
  ): Promise<Response | undefined>
}
