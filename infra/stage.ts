export const domain = (() => {
  if ($app.stage === "production") return "nikcli.store"
  if ($app.stage === "dev") return "dev.nikcli.store"
  return `${$app.stage}.dev.nikcli.store`
})()

export const zoneID = process.env.CLOUDFLARE_ZONE_ID || "82f17a4b22bcba84c427c628db9eddb5"

new cloudflare.RegionalHostname("RegionalHostname", {
  hostname: domain,
  regionKey: "us",
  zoneId: zoneID,
})

export const shortDomain = (() => {
  if ($app.stage === "production") return "s.nikcli.store"
  if ($app.stage === "dev") return "dev.s.nikcli.store"
  return `${$app.stage}.dev.s.nikcli.store`
})()
