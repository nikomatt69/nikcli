interface ImportMetaEnv {
  readonly VITE_NIKCLI_SERVER_HOST: string
  readonly VITE_NIKCLI_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
