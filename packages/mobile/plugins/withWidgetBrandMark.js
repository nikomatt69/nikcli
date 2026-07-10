/**
 * Copies the shared brand mark into the widget extension asset catalog so
 * Live Activity / Dynamic Island layouts can render the app icon image.
 */
const fs = require("fs")
const path = require("path")
const { IOSConfig, withDangerousMod, withXcodeProject } = require("expo/config-plugins")

const MARK = "app-icon-mark.png"
const IMAGESET = "BrandMark.imageset"
const ASSETS_CATALOG = "ExpoWidgetsTarget/Assets.xcassets"

function writeImageset(targetDir, sourcePath) {
  fs.mkdirSync(targetDir, { recursive: true })
  fs.copyFileSync(sourcePath, path.join(targetDir, MARK))
  fs.writeFileSync(
    path.join(targetDir, "Contents.json"),
    JSON.stringify(
      {
        images: [{ filename: MARK, idiom: "universal", scale: "1x" }],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(
    path.join(targetDir, "..", "Contents.json"),
    JSON.stringify(
      {
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    ),
  )
}

function widgetTargetUuid(project) {
  const section = project.pbxNativeTargetSection()
  for (const key of Object.keys(section)) {
    const entry = section[key]
    if (typeof entry === "object" && entry.name === "ExpoWidgetsTarget") {
      return key
    }
  }
  return null
}

const withWidgetBrandMarkFiles = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const source = path.join(cfg.modRequest.projectRoot, "assets", MARK)
      if (!fs.existsSync(source)) return cfg

      const widgetAssets = path.join(
        cfg.modRequest.platformProjectRoot,
        ASSETS_CATALOG,
        IMAGESET,
      )
      writeImageset(widgetAssets, source)
      return cfg
    },
  ])

const withWidgetBrandMarkXcode = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults
    const targetUuid = widgetTargetUuid(project)
    if (!targetUuid) return cfg

    const filepath = ASSETS_CATALOG
    if (project.hasFile(filepath)) return cfg

    cfg.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath,
      groupName: "ExpoWidgetsTarget",
      isBuildFile: true,
      project,
      targetUuid,
      verbose: true,
    })
    return cfg
  })

module.exports = (config) => withWidgetBrandMarkXcode(withWidgetBrandMarkFiles(config))
