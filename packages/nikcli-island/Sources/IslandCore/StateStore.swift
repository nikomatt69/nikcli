import Foundation

/// Reads (and, for parity/testing, writes) the per-session state files in
/// `~/Library/Application Support/NikcliIsland/state.d`. The real writer in production
/// is TypeScript (packages/nikcli/src/plugin/island/bridge.ts); this type exists mainly
/// as the read side the app actually uses, plus a symmetric `write` so Swift-side tests
/// and local development don't need a running nikcli process.
public enum StateStore {

    /// Restrict the session id to filename-safe characters so it can't escape the
    /// directory. Mirrors the bridge's own sanitizer.
    public static func safeID(_ s: String) -> String {
        let cleaned = s.unicodeScalars.map { scalar -> Character in
            let ok = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-")
            return ok.contains(scalar) ? Character(scalar) : "_"
        }
        let trimmed = String(cleaned.prefix(80))
        return trimmed.isEmpty ? "unknown" : trimmed
    }

    public static func fileName(sessionId: String) -> String {
        "nikcli-\(safeID(sessionId)).json"
    }

    public static func fileURL(sessionId: String) -> URL {
        Island.stateDir.appendingPathComponent(fileName(sessionId: sessionId))
    }

    /// Atomically write a snapshot. Best-effort: never throws.
    public static func write(_ snapshot: SessionSnapshot) {
        Island.ensureDirs()
        let url = fileURL(sessionId: snapshot.sessionId)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(snapshot) else { return }
        let fm = FileManager.default
        let perms: [FileAttributeKey: Any] = [.posixPermissions: 0o600]
        let tmp = url.deletingLastPathComponent()
            .appendingPathComponent(url.lastPathComponent + ".\(ProcessInfo.processInfo.processIdentifier).tmp")
        do {
            try data.write(to: tmp, options: .atomic)
            try? fm.setAttributes(perms, ofItemAtPath: tmp.path)
            _ = try fm.replaceItemAt(url, withItemAt: tmp)
            try? fm.setAttributes(perms, ofItemAtPath: url.path)
        } catch {
            try? data.write(to: url, options: .atomic)
            try? fm.setAttributes(perms, ofItemAtPath: url.path)
            try? fm.removeItem(at: tmp)
        }
    }

    public static func remove(sessionId: String) {
        try? FileManager.default.removeItem(at: fileURL(sessionId: sessionId))
    }

    /// All current state files (ignores in-flight `.tmp` files).
    public static func listFiles() -> [URL] {
        let fm = FileManager.default
        let items = (try? fm.contentsOfDirectory(at: Island.stateDir,
                                                 includingPropertiesForKeys: [.contentModificationDateKey],
                                                 options: [.skipsHiddenFiles])) ?? []
        return items.filter { $0.pathExtension == "json" }
    }

    public static func read(_ url: URL) -> SessionSnapshot? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(SessionSnapshot.self, from: data)
    }

    public static func clearAll() {
        for url in listFiles() { try? FileManager.default.removeItem(at: url) }
    }
}
