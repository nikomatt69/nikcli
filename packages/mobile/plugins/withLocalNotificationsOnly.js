/**
 * Personal Team accounts cannot sign apps with the Push Notifications capability.
 * expo-notifications adds `aps-environment`, which blocks local device installs.
 *
 * Strips the remote-push entitlement while keeping local notifications and Live
 * Activities (App Groups) intact.
 */
const fs = require("fs")
const path = require("path")
const { withEntitlementsPlist, withDangerousMod } = require("expo/config-plugins")

function stripPushEntitlement(contents) {
  return contents.replace(/\s*<key>aps-environment<\/key>\s*<string>[^<]*<\/string>\s*/g, "\n")
}

const withEntitlementsMod = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["aps-environment"]
    return cfg
  })

const withEntitlementsFile = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const projectName = cfg.modRequest.projectName || cfg.name
      const entitlementsPath = path.join(cfg.modRequest.platformProjectRoot, projectName, `${projectName}.entitlements`)
      if (fs.existsSync(entitlementsPath)) {
        const next = stripPushEntitlement(fs.readFileSync(entitlementsPath, "utf8"))
        fs.writeFileSync(entitlementsPath, next)
      }
      return cfg
    },
  ])

module.exports = (config) => withEntitlementsFile(withEntitlementsMod(config))
