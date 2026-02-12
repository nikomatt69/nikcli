import { SECRET } from "./secret"
import { shortDomain } from "./stage"

const storage = new sst.cloudflare.Bucket("EnterpriseStorage")

const teams = new sst.cloudflare.x.SolidStart("Teams", {
  domain: shortDomain,
  path: "packages/enterprise",
  buildCommand: "bun run build:cloudflare",
  environment: {
    NIKCLI_STORAGE_ADAPTER: "r2",
    NIKCLI_STORAGE_ACCOUNT_ID: sst.cloudflare.DEFAULT_ACCOUNT_ID,
    NIKCLI_STORAGE_ACCESS_KEY_ID: SECRET.R2AccessKey.value,
    NIKCLI_STORAGE_SECRET_ACCESS_KEY: SECRET.R2SecretKey.value,
    NIKCLI_STORAGE_BUCKET: storage.name,
  },
})
