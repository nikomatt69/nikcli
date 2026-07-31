declare module "turndown-plugin-gfm" {
  import TurndownService = require("turndown")

  export const gfm: (service: TurndownService) => void
}
