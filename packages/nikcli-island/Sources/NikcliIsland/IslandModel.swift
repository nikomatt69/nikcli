import SwiftUI
import CoreGraphics
import IslandCore

/// What the island is currently showing. The app controller pushes updates into this on
/// each poll; the SwiftUI view observes it. Hover is owned by the view; `forceExpand`
/// lets the controller auto-open the island on an important change (e.g. a permission).
@MainActor
final class IslandModel: ObservableObject {
    @Published var isVisible = false
    @Published var provider: Provider = .nikcli
    @Published var state: AgentState = .idle
    @Published var label: String = ""
    @Published var detail: String = ""
    @Published var startedAt: Double = 0
    /// Set while state == .permission; non-empty enables the Allow/Deny controls.
    @Published var permissionId: String = ""
    @Published var permissionPort: Int32 = 0

    @Published var sessions: [SessionInfo] = []
    @Published var displayedId: String = ""
    @Published var pinnedId: String? = nil

    var isMulti: Bool { sessions.count >= 2 }
    var dropHeight: CGFloat { isMulti ? Theme.stackDropHeight(sessions.count) : Theme.dropHeight }

    @Published var forceExpand = false
    @Published var userExpanded = false
    @Published var hovering = false
    @Published var collapsing = false
    @Published var opening = false

    var isExpanded: Bool { userExpanded }
    var isTall: Bool { (hovering || userExpanded || forceExpand) && !collapsing && !opening }

    @Published var topInset: CGFloat = 32
    @Published var notchWidth: CGFloat = 190
    @Published var hasNotch: Bool = true

    var onActivate: (() -> Void)?
    var onSelectSession: (String) -> Void = { _ in }
    /// Reply to the currently-displayed permission request ("once" or "reject").
    var onReplyPermission: (String) -> Void = { _ in }

    var onQuit: () -> Void = {}
    var onChooseDisplay: (CGDirectDisplayID?) -> Void = { _ in }

    var showsTimer: Bool { state.isWorking && startedAt > 0 }
}
