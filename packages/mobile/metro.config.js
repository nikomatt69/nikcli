const path = require("path")
const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

// Include workspace root so Metro can see packages hoisted by Bun
config.watchFolders = [workspaceRoot]

// Force every import of react / react-native to resolve to THIS package's copy,
// preventing multiple React instances when workspace deps require them too.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const deduplicated = ["react", "react-native", "react/jsx-runtime", "react/jsx-dev-runtime"]
  if (deduplicated.includes(moduleName)) {
    const resolved = path.resolve(projectRoot, "node_modules", moduleName)
    return { filePath: require.resolve(resolved), type: "sourceFile" }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = withNativeWind(config, { input: "./global.css" })
