import AppKit

/// Notch geometry, derived from the system's safe-area APIs (macOS 12+) rather than hardcoded
/// pixel sizes, so it's correct across the 14"/16" MacBook Pro and the notched MacBook Air.
extension NSScreen {

    /// True when this display has a camera-housing notch.
    var hasNotch: Bool {
        if #available(macOS 12.0, *) {
            return auxiliaryTopLeftArea != nil && auxiliaryTopRightArea != nil && safeAreaInsets.top > 0
        }
        return false
    }

    /// The size of the physical notch, if any.
    var notchSize: NSSize? {
        guard #available(macOS 12.0, *),
              let left = auxiliaryTopLeftArea?.width,
              let right = auxiliaryTopRightArea?.width,
              safeAreaInsets.top > 0
        else { return nil }
        let width = frame.width - left - right
        return NSSize(width: width, height: safeAreaInsets.top)
    }

    /// The notch's frame in this screen's coordinate space (top-centered).
    var notchFrame: NSRect? {
        guard let size = notchSize else { return nil }
        return NSRect(x: frame.midX - size.width / 2,
                      y: frame.maxY - size.height,
                      width: size.width,
                      height: size.height)
    }

    /// Height to treat as the "notch" on a non-notched display. Real-notch proportions (~32pt,
    /// like the 14" MacBook Pro), or the menu bar if it's taller, so the drawn notch reads
    /// exactly like the hardware one.
    var syntheticNotchHeight: CGFloat {
        let menuBar = frame.maxY - visibleFrame.maxY   // includes the menu bar
        return max(32, menuBar)
    }

    /// Width of the synthetic notch drawn on non-notched displays: the 14" MacBook Pro's
    /// physical notch width, so the island looks identical everywhere.
    static let syntheticNotchWidth: CGFloat = 190

    /// Effective top inset where island content should begin (real notch height or menu bar).
    var islandTopInset: CGFloat { notchSize?.height ?? syntheticNotchHeight }

    /// This display's stable-ish CoreGraphics id, used to remember the user's chosen screen.
    var displayID: CGDirectDisplayID? {
        (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
    }

    /// The user's preferred island display (by CGDirectDisplayID), or nil for automatic.
    /// Persisted so the choice survives relaunches.
    /// Note: CGDirectDisplayID can change across reconnects/reboots; when the saved id
    /// isn't currently connected we fall back to automatic, so a stale id is self-healing.
    static var preferredDisplayID: CGDirectDisplayID? {
        get {
            let v = UserDefaults.standard.integer(forKey: "preferredDisplayID")
            return v > 0 ? CGDirectDisplayID(v) : nil
        }
        set {
            if let id = newValue { UserDefaults.standard.set(Int(id), forKey: "preferredDisplayID") }
            else { UserDefaults.standard.removeObject(forKey: "preferredDisplayID") }
        }
    }

    /// True when the saved display preference points at a currently-connected screen (i.e. the
    /// preference is actually in effect, not lying dormant while we fall back to automatic).
    static var preferredDisplayConnected: Bool {
        guard let id = preferredDisplayID else { return false }
        return screens.contains { $0.displayID == id }
    }

    /// The screen we should render the island on: the user's chosen display if it's connected,
    /// else the MacBook's own screen — notched if present, else any built-in panel — and only
    /// then the main/first screen (e.g. clamshell mode, where no built-in is listed).
    static var islandScreen: NSScreen? {
        if let id = preferredDisplayID,
           let chosen = screens.first(where: { $0.displayID == id }) {
            return chosen
        }
        return screens.first(where: { $0.hasNotch })
            ?? screens.first(where: { $0.displayID.map { CGDisplayIsBuiltin($0) != 0 } ?? false })
            ?? NSScreen.main ?? screens.first
    }
}
