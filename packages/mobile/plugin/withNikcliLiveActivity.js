const { withDangerousMod } = require("@expo/config-plugins")
const fs = require("fs")
const path = require("path")

const CODEBRO_IMAGE_SOURCE = path.join(__dirname, "../assets/liveActivity/codebro.png")
const CODEBRO_IMAGE_DEST = path.join(__dirname, "../ios/LiveActivity/Assets.xcassets/codebro.imageset/codebro.png")
const CODEBRO_CONTENTS_JSON = path.join(__dirname, "../ios/LiveActivity/Assets.xcassets/codebro.imageset/Contents.json")

function copyCodebroImage() {
  const destDir = path.dirname(CODEBRO_IMAGE_DEST)

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }

  if (fs.existsSync(CODEBRO_IMAGE_SOURCE)) {
    fs.copyFileSync(CODEBRO_IMAGE_SOURCE, CODEBRO_IMAGE_DEST)
    console.log("[nikcli] Copied codebro.png to LiveActivity assets")
  }

  if (!fs.existsSync(CODEBRO_CONTENTS_JSON)) {
    fs.writeFileSync(
      CODEBRO_CONTENTS_JSON,
      JSON.stringify(
        {
          images: [{ filename: "codebro.png", idiom: "universal" }],
          info: { author: "xcode", version: 1 },
        },
        null,
        2,
      ),
    )
    console.log("[nikcli] Created codebro.imageset/Contents.json")
  }
}

module.exports = function withNikcliLiveActivity(config) {
  return withDangerousMod(config, [
    (config) => {
      copyCodebroImage()
      return config
    },
  ])
}
