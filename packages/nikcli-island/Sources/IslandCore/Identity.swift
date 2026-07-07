import Foundation

/// Stable identity + on-disk locations shared by the CLI bridge (which writes) and the
/// app (which reads). Everything lives under one Application Support directory so it's
/// easy to inspect, back up, and fully remove.
///
/// The state directory's *shape* — one JSON file per session under `state.d/`, atomic
/// writes, owner-only permissions — is intentionally identical to Pookify's, since it's
/// a proven contract. The writer is different: `packages/nikcli/src/plugin/island/bridge.ts`
/// writes these files directly from nikcli's own event bus, not from a compiled hook
/// helper parsing a tool's stdin.
public enum Island {
    /// Bundle identifier of the app (used to `open -g -b` it when a session starts).
    public static let bundleID = "com.nikcli.island"

    /// Human-facing app name.
    public static let appName = "NikcliIsland"

    /// Mach-O executable name inside the bundle.
    public static let executableName = "NikcliIsland"

    /// Schema version stamped into each state file. Informational only: the reader is
    /// field-tolerant, so it isn't gated on this number.
    public static let stateSchema = 1

    /// `~/Library/Application Support/NikcliIsland`. ISLAND_SUPPORT_DIR overrides it
    /// (dev/tests only).
    public static var supportDir: URL {
        if let p = ProcessInfo.processInfo.environment["ISLAND_SUPPORT_DIR"], !p.isEmpty {
            return URL(fileURLWithPath: p, isDirectory: true)
        }
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent(appName, isDirectory: true)
    }

    /// `.../state.d` — one JSON file per live session, written by the nikcli CLI bridge.
    public static var stateDir: URL { supportDir.appendingPathComponent("state.d", isDirectory: true) }

    /// PID of the running app (written on launch, removed on a clean quit), so any
    /// nikcli process can tell whether the app needs waking, and the app itself can
    /// tell whether another instance already owns the notch.
    public static var appPidFile: URL { supportDir.appendingPathComponent("app.pid") }

    public static func ensureDirs() {
        // Owner-only (0700): state files record each session's absolute cwd/project.
        let attrs: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
        let fm = FileManager.default
        for dir in [supportDir, stateDir] {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: attrs)
            try? fm.setAttributes(attrs, ofItemAtPath: dir.path)
        }
    }
}
