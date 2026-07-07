import AppKit
import IslandCore

// NikcliIsland — background agent (no Dock icon, no menu bar item). UI lives entirely
// on the notch. Driven from an AppDelegate rather than the SwiftUI App lifecycle so it
// behaves correctly when built as a bare SwiftPM executable wrapped in a hand-assembled
// bundle.
//
// Unlike Pookify there is no hook to install/uninstall here: nikcli's own CLI process
// writes the state files directly (packages/nikcli/src/plugin/island/bridge.ts), so this
// binary has exactly one job — read them and draw the notch.
MainActor.assumeIsolated {
    let app = NSApplication.shared
    let controller = AppController()
    app.delegate = controller
    app.setActivationPolicy(.accessory)
    app.run()
}
