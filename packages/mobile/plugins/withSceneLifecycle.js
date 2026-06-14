/**
 * Config plugin: adopt the iOS UIScene lifecycle (required by the iOS 26/27 SDK).
 *
 * The pinned expo-modules-core (56.0.16) predates `ExpoAppSceneDelegate`, so the
 * default prebuild template still generates the legacy window-in-AppDelegate setup,
 * which hard-crashes on launch under the iOS 27 SDK
 * (`___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`).
 *
 * This plugin makes the generated native project scene-compatible on every prebuild:
 *   1. writes a self-contained UIKit `SceneDelegate.swift`
 *   2. strips window creation from the generated `AppDelegate.swift`
 *   3. registers `SceneDelegate.swift` in the Xcode target's Sources phase
 *
 * The `UIApplicationSceneManifest` itself is set via `ios.infoPlist` in app.json.
 */
const fs = require("fs")
const path = require("path")
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins")

const POD_DEPLOYMENT_MARKER = "withSceneLifecycle: pod deployment target"

const SCENE_DELEGATE_SWIFT = `import UIKit
import React

// UIScene lifecycle adoption (required by the iOS 26/27 SDK).
// Managed by the withSceneLifecycle config plugin.
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
    window.makeKeyAndVisible()

    self.window = window
    appDelegate.window = window
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    _ = UIApplication.shared.delegate?.application?(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = UIApplication.shared.delegate?.application?(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}
`

function getProjectName(config) {
  return config.modRequest.projectName || config.name
}

const withSceneDelegateFile = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const projectName = getProjectName(cfg)
      const iosRoot = cfg.modRequest.platformProjectRoot
      const targetDir = path.join(iosRoot, projectName)

      // 1. write SceneDelegate.swift
      fs.writeFileSync(path.join(targetDir, "SceneDelegate.swift"), SCENE_DELEGATE_SWIFT)

      // 2. strip the legacy window creation from AppDelegate.swift
      const appDelegatePath = path.join(targetDir, "AppDelegate.swift")
      if (fs.existsSync(appDelegatePath)) {
        let contents = fs.readFileSync(appDelegatePath, "utf8")
        contents = contents.replace(
          /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow[\s\S]*?#endif\s*\n/m,
          "    // Window + React Native start handled by SceneDelegate (iOS 26/27 UIScene lifecycle).\n",
        )
        fs.writeFileSync(appDelegatePath, contents)
      }

      return cfg
    },
  ])

const withSceneDelegateInPbxproj = (config) =>
  withXcodeProject(config, (cfg) => {
    const projectName = getProjectName(cfg)
    const project = cfg.modResults
    const relPath = `${projectName}/SceneDelegate.swift`

    const already = Object.values(project.hash.project.objects.PBXFileReference || {}).some(
      (ref) => typeof ref === "object" && ref.path && ref.path.includes("SceneDelegate.swift"),
    )
    if (!already) {
      const group = project.findPBXGroupKey({ name: projectName }) || project.getFirstProject().firstProject.mainGroup
      project.addSourceFile(relPath, {}, group)
    }
    return cfg
  })

// Force every pod target (including resource-bundle targets such as
// RNCAsyncStorage_resources / RNSVGFilters) up to the app's minimum deployment
// target. Some pods ship low IPHONEOS_DEPLOYMENT_TARGET values (12.4 / 13.4)
// that the iOS 27 SDK rejects. Patched into the generated Podfile so it survives
// prebuild without hand-editing native files.
const withPodDeploymentTarget = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile")
      if (!fs.existsSync(podfilePath)) return cfg
      let contents = fs.readFileSync(podfilePath, "utf8")
      if (contents.includes(POD_DEPLOYMENT_MARKER)) return cfg

      const minIos = (cfg.ios && cfg.ios.deploymentTarget) || "16.4"
      const snippet = `
    # ${POD_DEPLOYMENT_MARKER}
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |bc|
        bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${minIos}'
      end
    end
`
      // Insert right after the react_native_post_install(...) call inside post_install.
      const patched = contents.replace(/(react_native_post_install\([\s\S]*?\)\n)/, `$1${snippet}`)
      if (patched !== contents) {
        fs.writeFileSync(podfilePath, patched)
      }
      return cfg
    },
  ])

module.exports = (config) => withPodDeploymentTarget(withSceneDelegateInPbxproj(withSceneDelegateFile(config)))
