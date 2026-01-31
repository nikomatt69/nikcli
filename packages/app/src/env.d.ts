/// <reference types="vite/client" />

declare module "*.tsx" {
  const component: any
  export default component
}

declare module "*.ts" {
  const content: any
  export default content
}
