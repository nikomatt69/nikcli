declare module "localtunnel" {
  interface Tunnel {
    url: string
    close: () => void
    on: (event: string, callback: () => void) => void
  }

  interface TunnelOptions {
    port: number | string
    local_host?: string
    subdomain?: string
    host?: string
    local_https?: boolean
    local_cert?: string
    local_key?: string
    local_ca?: string
    allow_invalid_cert?: boolean
  }

  interface Localtunnel {
    (options: TunnelOptions): Promise<Tunnel>
  }

  const localtunnel: Localtunnel
  export = localtunnel
}
