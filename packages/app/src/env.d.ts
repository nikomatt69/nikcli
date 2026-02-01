/// <reference types="vite/client" />

declare module "*.tsx" {
  const component: any
  export default component
}

declare module "*.ts" {
  const content: any
  export default content
}

interface ImportMetaEnv {
  readonly VITE_NIKCLI_URL?: string
  readonly VITE_API_URL?: string
  readonly VITE_NIKCLI_USERNAME?: string
  readonly VITE_API_USERNAME?: string
  readonly VITE_NIKCLI_PASSWORD?: string
  readonly VITE_API_PASSWORD?: string
  readonly VITE_NIKCLI_DIRECTORY?: string
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
