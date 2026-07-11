const path = require("path")
const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

// Treat terminal runtime bundles as assets (not JS modules).
config.resolver.assetExts = Array.from(new Set([...(config.resolver.assetExts ?? []), "txt", "html"]))
config.resolver.sourceExts = (config.resolver.sourceExts ?? []).filter((ext) => ext !== "txt")

// Include workspace root so Metro can see packages hoisted by Bun
config.watchFolders = [workspaceRoot]

// Force every import of react / react-dom / react-native to resolve to THIS
// package's copy, preventing multiple React instances when workspace deps
// require different majors (companion/web use 18.x, mobile uses 19.x). Without
// deduping react-dom (and subpaths) too, web/SSR rendering throws
// "Invalid hook call / more than one copy of React".
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isReactModule =
    moduleName === "react" ||
    moduleName === "react-dom" ||
    moduleName === "react-native" ||
    moduleName.startsWith("react/") ||
    moduleName.startsWith("react-dom/")
  if (isReactModule) {
    return {
      filePath: require.resolve(moduleName, { paths: [path.join(projectRoot, "node_modules")] }),
      type: "sourceFile",
    }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = withNativeWind(config, { input: "./global.css" })
