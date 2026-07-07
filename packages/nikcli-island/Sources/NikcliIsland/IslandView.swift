import SwiftUI
import AppKit
import IslandCore

/// Root of the notch UI. Anchored flush to the top of the screen so it fuses with the
/// physical notch, easing in/out with the reveal transition.
struct IslandRootView: View {
    @ObservedObject var model: IslandModel

    var body: some View {
        VStack(spacing: 0) {
            if model.isVisible {
                IslandPill(model: model)
                    .transition(.notchReveal)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

/// Widens from a hairline slit while fading + de-blurring in, so the pill reads as
/// materializing out of the notch rather than an instant slab that then stretches.
private struct NotchReveal: ViewModifier {
    let progress: Double
    func body(content: Content) -> some View {
        content
            .scaleEffect(x: max(0.001, progress), y: 0.7 + 0.3 * progress, anchor: .top)
            .opacity(progress)
            .blur(radius: (1 - progress) * 3)
    }
}
private struct NotchRetract: ViewModifier {
    let progress: Double
    func body(content: Content) -> some View {
        content
            .scaleEffect(x: max(0.001, progress), y: 0.85 + 0.15 * progress, anchor: .top)
            .opacity(progress)
    }
}
extension AnyTransition {
    static var notchReveal: AnyTransition {
        .asymmetric(
            insertion: .modifier(active: NotchReveal(progress: 0), identity: NotchReveal(progress: 1))
                .animation(Theme.appear),
            removal: .modifier(active: NotchRetract(progress: 0), identity: NotchRetract(progress: 1))
                .animation(Theme.disappear)
        )
    }
}

/// The notch-fused black island.
///
/// - **Closed (slim):** the nikcli glyph on the left of the camera, live timer on the
///   right — symmetric, no words.
/// - **Expanded:** grows taller (never wider), status wording and a detail line drop in
///   below the notch. A permission request adds Allow/Deny directly in the drop-down —
///   nikcli's own HTTP API makes this two-way, unlike a one-way hook file.
struct IslandPill: View {
    @ObservedObject var model: IslandModel
    @State private var hoverWork: DispatchWorkItem?
    @State private var stackEdges = StackEdges(top: false, bottom: false)
    @State private var pressed = false

    private let wing: CGFloat = Theme.wing
    private let iconSize: CGFloat = 18
    private let wingInset: CGFloat = 4

    private var expanded: Bool {
        (model.hovering || model.isExpanded) && !model.collapsing && !model.opening
    }
    private var closedH: CGFloat { model.topInset }
    private var gap: CGFloat { model.notchWidth }
    private var closedWidth: CGFloat { wing + gap + wing }

    private func textWidth(_ s: String, _ size: CGFloat, _ weight: NSFont.Weight) -> CGFloat {
        ceil((s as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: weight)]).width)
    }
    private var labelW: CGFloat { textWidth(statusTitle, 13.5, .semibold) }

    // A thin brand strip under the camera row, visible at rest AND expanded — unlike
    // the rest of dropDown, it isn't gated by `expanded`, so the nikcli mark reads even
    // on a pill nobody's hovering.
    private let logoRowHeight: CGFloat = 17

    private var pillWidth: CGFloat {
        expanded && !model.isMulti ? max(closedWidth, labelW + 40) : closedWidth
    }
    private var pillHeight: CGFloat {
        let base = closedH + logoRowHeight + (expanded ? model.dropHeight : 0)
        guard expanded && showsPermissionActions else { return base }
        // The multi-session bar adds a "Replying to …" caption above Allow/Deny so it's
        // unambiguous which row the buttons target — a few extra points of height for it.
        return base + 34 + (model.isMulti ? 14 : 0)
    }

    var body: some View {
        let topR: CGFloat = 7
        let bottomR: CGFloat = expanded ? 20 : max(13, closedH * 0.40)
        let shape = NotchShape(topRadius: topR, bottomRadius: bottomR)

        ZStack(alignment: .top) {
            shape.fill(Theme.pill)
            VStack(spacing: 0) {
                notchRow
                    .frame(width: closedWidth, height: closedH)
                logoRow
                    .frame(height: logoRowHeight)
                dropDown
                    .frame(height: model.dropHeight)
                    .opacity(expanded ? 1 : 0)
                    .offset(y: expanded ? 0 : -4)
                if showsPermissionActions {
                    permissionActions
                        .opacity(expanded ? 1 : 0)
                        .offset(y: expanded ? 0 : 6)
                }
            }
        }
        .frame(width: pillWidth, height: pillHeight, alignment: .top)
        .clipShape(shape)
        .contentShape(shape)
        .scaleEffect(pressed ? 0.97 : 1)
        // A soft glow instead of Pookify's "no shadow, pure black" stance — light blue at
        // rest/working (echoes the accent), whiter on success. Three blurred layers,
        // each wider and fainter than the last, so the glow has a long, soft falloff
        // instead of reading as one hard-edged blur ring.
        .shadow(color: glowColor.opacity(0.5), radius: 10, x: 0, y: 0)
        .shadow(color: glowColor.opacity(0.32), radius: 24, x: 0, y: 0)
        .shadow(color: glowColor.opacity(0.16), radius: 42, x: 0, y: 0)
        .onHover { isOver in
            hoverWork?.cancel()
            if isOver {
                let work = DispatchWorkItem { model.hovering = true }
                hoverWork = work
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
            } else {
                model.hovering = false
            }
        }
        // Tactile press feedback for the pill itself, matching IslandButtonStyle's weight
        // so tapping the whole island feels like the same material as tapping Allow/Deny.
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in if !pressed { pressed = true } }
                .onEnded { _ in pressed = false }
        )
        .onTapGesture { model.onActivate?() }
        .contextMenu { menuItems }
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: pressed)
        .animation(Theme.expand, value: expanded)
        .animation(Theme.expand, value: model.state)
        .animation(Theme.expand, value: model.showsTimer)
        .animation(Theme.expand, value: model.sessions.count)
        .animation(Theme.expand, value: pendingPermissionCount)
    }

    // MARK: closed row

    private var notchRow: some View {
        HStack(spacing: 0) {
            AgentGlyph(provider: model.provider, working: model.state.isWorking, size: iconSize)
                .frame(width: iconSize, height: iconSize)
                .frame(width: wing, height: closedH)
                .offset(x: wingInset)

            Color.clear.frame(width: gap, height: closedH)

            rightStatus
                .frame(width: wing, height: closedH)
                .offset(x: -wingInset)
        }
    }

    /// How many live sessions are simultaneously blocked on a permission — surfaced as
    /// its own amber badge so "3 subagents waiting on you" is visible from the closed
    /// pill, distinct from the plain white "N sessions working" bubble.
    private var pendingPermissionCount: Int {
        model.sessions.filter { $0.state == .permission }.count
    }

    @ViewBuilder private var rightStatus: some View {
        if model.isMulti && pendingPermissionCount > 0 {
            Text("\(pendingPermissionCount)")
                .font(.system(size: 10.5, weight: .bold).monospacedDigit())
                .foregroundStyle(.black)
                .lineLimit(1)
                .padding(.horizontal, 6.5)
                .padding(.vertical, 2.5)
                .background(Capsule().fill(Theme.amber))
                .transition(.scale(scale: 0.4).combined(with: .opacity))
        } else if model.isMulti && model.state.isWorking {
            Text("\(model.sessions.count)")
                .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                .foregroundStyle(.white.opacity(0.95))
                .lineLimit(1)
                .padding(.horizontal, 6.5)
                .padding(.vertical, 2.5)
                .background(Capsule().fill(.white.opacity(0.13)))
        } else if model.showsTimer {
            TimerText(startedAt: model.startedAt)
                .font(.system(size: 12, weight: .semibold).monospacedDigit())
                .foregroundStyle(.white.opacity(0.92))
                .lineLimit(1)
        } else {
            // Each glyph pops in with a spring scale + fade rather than a hard cross-fade,
            // so "Done"/"Error"/permission landing reads as a small, deliberate arrival.
            switch model.state {
            case .permission:
                Circle().fill(Theme.amber).frame(width: 8, height: 8)
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
            case .done:
                Image(systemName: "checkmark")
                    .font(.system(size: iconSize * 0.62, weight: .bold))
                    .foregroundStyle(Theme.accent(model.provider))
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
            case .error:
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: iconSize * 0.6, weight: .semibold))
                    .foregroundStyle(Theme.amber)
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
            default:
                Color.clear
            }
        }
    }

    // MARK: brand strip (always visible)

    @ViewBuilder private var logoRow: some View {
        if let logo = WordmarkAsset.image {
            Image(nsImage: logo)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(height: 13)
                .opacity(0.82)
        } else {
            Capsule()
                .fill(.white.opacity(0.35))
                .frame(width: 22, height: 2)
        }
    }

    // MARK: drop-down

    @ViewBuilder private var dropDown: some View {
        if model.isMulti {
            sessionStack
        } else {
            singleDrop
        }
    }

    private var singleDrop: some View {
        VStack(spacing: 4) {
            if model.state.isWorking {
                WorkingLabel(word: statusWord)
            } else {
                Text(statusTitle)
                    .font(.system(size: 13.5, weight: .semibold))
                    .tracking(0.1)
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }
            Capsule()
                .fill(accentColor)
                .frame(width: 26, height: 2.5)
                .opacity(0.9)
            if !model.detail.isEmpty {
                Text(model.detail)
                    .font(.system(size: 10.5, weight: .regular))
                    .foregroundStyle(.white.opacity(0.5))
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.top, 5)
    }

    /// Whether the currently-displayed session is an actionable permission request (has
    /// both a request id and a known port to reply to). Available in multi-session mode
    /// too — Allow/Deny must not disappear just because a subagent's siblings are also
    /// live, or approving a delegated permission would require dropping to the terminal.
    private var showsPermissionActions: Bool {
        model.state == .permission && !model.permissionId.isEmpty && model.permissionPort > 0
    }

    /// The session `permissionActions` will actually reply to (== model.displayedId).
    /// Only looked up to label the button row in multi-session mode, where several
    /// rows can be visible at once and it's otherwise ambiguous which one Allow/Deny
    /// targets.
    private var displayedSessionInfo: SessionInfo? {
        model.sessions.first { $0.id == model.displayedId }
    }

    private var permissionActions: some View {
        VStack(spacing: 6) {
            if model.isMulti, let info = displayedSessionInfo {
                Text("Replying to \(info.isSubagent && !info.agentTitle.isEmpty ? info.agentTitle : info.project)")
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            permissionButtons
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private var permissionButtons: some View {
        HStack(spacing: 8) {
            Button {
                model.onReplyPermission("reject")
            } label: {
                Text("Deny")
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(0.2)
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6.5)
                    .background(Capsule().fill(.white.opacity(0.12)))
                    .overlay(Capsule().strokeBorder(.white.opacity(0.08), lineWidth: 1))
            }
            .buttonStyle(IslandButtonStyle())

            Button {
                model.onReplyPermission("once")
            } label: {
                Text("Allow")
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(0.2)
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6.5)
                    .background(Capsule().fill(Theme.amber))
            }
            .buttonStyle(IslandButtonStyle())
        }
    }

    // MARK: session stack (2+ sessions)

    @ViewBuilder private var sessionStack: some View {
        let scroll = ScrollView(.vertical) {
            VStack(spacing: Theme.sessionRowSpacing) {
                ForEach(model.sessions) { session in
                    SessionRow(session: session,
                               isDisplayed: session.id == model.displayedId,
                               select: { model.onSelectSession(session.id) })
                }
            }
            .padding(.horizontal, 6)
            .padding(.top, 7)
            .padding(.bottom, 9)
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize)

        if #available(macOS 15.0, *) {
            scroll
                .onScrollGeometryChange(for: StackEdges.self) { geo in
                    StackEdges(top: geo.contentOffset.y > 2,
                               bottom: geo.contentOffset.y + geo.containerSize.height
                                       < geo.contentSize.height - 2)
                } action: { _, edges in
                    stackEdges = edges
                }
                .mask(stackFog)
        } else {
            scroll
                .onAppear { stackEdges = StackEdges(top: false, bottom: stackOverflows) }
                .onChange(of: model.sessions.count) { _, _ in
                    stackEdges = StackEdges(top: false, bottom: stackOverflows)
                }
                .mask(stackFog)
        }
    }

    private var stackOverflows: Bool { model.sessions.count > Theme.sessionRowsVisible }

    private var stackFog: some View {
        let viewH = model.dropHeight
        let fogTop = stackEdges.top
        let fogBottom = stackEdges.bottom
        return (
            LinearGradient(stops: [
                .init(color: .black.opacity(fogTop ? 0 : 1), location: 0),
                .init(color: .black, location: fogTop ? 18 / viewH : 0),
                .init(color: .black, location: fogBottom ? 1 - 32 / viewH : 1),
                .init(color: .black.opacity(fogBottom ? 0.28 : 1), location: fogBottom ? 1 - 12 / viewH : 1),
                .init(color: .black.opacity(fogBottom ? 0 : 1), location: 1),
            ], startPoint: .top, endPoint: .bottom)
            .animation(.easeOut(duration: 0.18), value: fogTop)
            .animation(.easeOut(duration: 0.18), value: fogBottom)
        )
    }

    @ViewBuilder private var menuItems: some View {
        if let pin = model.pinnedId, model.isMulti {
            Button("Unpin — follow the busiest session") { model.onSelectSession(pin) }
            Divider()
        }
        if showsPermissionActions {
            Button("Allow") { model.onReplyPermission("once") }
            Button("Deny") { model.onReplyPermission("reject") }
            Divider()
        }
        if NSScreen.screens.count > 1 {
            Menu("Display") {
                Button((NSScreen.preferredDisplayConnected ? "" : "✓ ") + "Automatic") { chooseDisplay(nil) }
                Divider()
                ForEach(NSScreen.screens, id: \.self) { screen in
                    if let id = screen.displayID {
                        Button((NSScreen.preferredDisplayID == id ? "✓ " : "") + screenLabel(screen)) {
                            chooseDisplay(id)
                        }
                    }
                }
            }
        }
        Divider()
        Button("Quit") { model.onQuit() }
    }

    private func screenLabel(_ screen: NSScreen) -> String {
        var name = screen.localizedName
        if screen.hasNotch { name += " (built-in)" }
        else if screen == NSScreen.screens.first { name += " (main)" }
        return name
    }

    private func chooseDisplay(_ id: CGDirectDisplayID?) {
        hoverWork?.cancel()
        model.hovering = false
        model.onChooseDisplay(id)
    }

    private var accentColor: Color {
        switch model.state {
        case .permission, .error: return Theme.amber
        default:                  return Theme.accent(model.provider)
        }
    }

    /// The pill's ambient glow. White on a finished turn (a quiet "success" flash),
    /// amber while blocked/errored (matches the dot/underline), light blue otherwise —
    /// the same accent already used for the working glyph and timer.
    private var glowColor: Color {
        switch model.state {
        case .done:               return .white
        case .permission, .error: return Theme.amber
        default:                  return Theme.accent(model.provider)
        }
    }

    private var statusTitle: String {
        switch model.state {
        case .permission: return "Awaiting permission"
        case .done:       return "Done"
        case .error:      return "Error"
        case .idle:       return "Idle"
        default:          return model.label.isEmpty ? "Working…" : model.label
        }
    }

    private var statusWord: String {
        var w = statusTitle
        while let last = w.last, last == "…" || last == "." || last == " " { w.removeLast() }
        return w
    }
}

/// Tactile press feedback for the Allow/Deny controls: a quick scale-down + dim on
/// press, springing back on release — matches the weight of the rest of the pill's
/// motion (Theme.expand) instead of the system default's harder snap.
private struct IslandButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

private struct StackEdges: Equatable {
    var top: Bool
    var bottom: Bool
}

/// One session in the expanded stack: state dot · project · activity (+ file) · timer.
private struct SessionRow: View {
    let session: SessionInfo
    let isDisplayed: Bool
    let select: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(dotColor)
                .frame(width: 6, height: 6)
            // A subagent shares its parent's `project`, so several rows from the same
            // delegation would otherwise be indistinguishable — mark it with a small
            // turn-down glyph and prefer its own title as the row's headline instead.
            if session.isSubagent {
                Image(systemName: "arrow.turn.down.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.35))
            }
            Text(projectDisplay)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .layoutPriority(1)
            Group {
                if session.detail.isEmpty {
                    activityText
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 4) {
                            activityText
                            detailText
                        }
                        detailText
                    }
                }
            }
            .layoutPriority(0.9)
            Spacer(minLength: 4)
            trailing
                .layoutPriority(1)
        }
        .padding(.horizontal, 8)
        .frame(height: Theme.sessionRowHeight)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(.white.opacity(isDisplayed ? 0.09 : hovering ? 0.05 : 0))
        )
        .contentShape(Rectangle())
        .onTapGesture(perform: select)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering)
        .animation(.easeOut(duration: 0.15), value: isDisplayed)
        .animation(Theme.expand, value: session.state)
    }

    private var dotColor: Color {
        switch session.state {
        case .permission, .error: return Theme.amber
        default:                  return Theme.accent(session.provider)
        }
    }

    private var activityText: some View {
        Text(activityWord)
            .font(.system(size: 10.5))
            .foregroundStyle(session.state == .permission ? Theme.amber : .white.opacity(0.52))
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private var detailText: some View {
        Text("· " + session.detail)
            .font(.system(size: 10.5))
            .foregroundStyle(.white.opacity(0.52))
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private var projectDisplay: String {
        let p = session.isSubagent && !session.agentTitle.isEmpty
            ? session.agentTitle
            : (session.project.isEmpty ? "session" : session.project)
        return p.count > 20 ? p.prefix(19) + "…" : p
    }

    private var activityWord: String {
        switch session.state {
        case .permission: return "Awaiting permission"
        case .done:       return "Done"
        case .error:      return "Error"
        default:          return session.label.isEmpty ? "Working…" : session.label
        }
    }

    @ViewBuilder private var trailing: some View {
        if session.startedAt > 0 {
            TimerText(startedAt: session.startedAt)
                .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                .foregroundStyle(.white.opacity(session.state == .permission ? 0.55 : 0.8))
        } else if session.state == .done {
            Image(systemName: "checkmark")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Theme.accent(session.provider))
                .transition(.scale(scale: 0.4).combined(with: .opacity))
        } else if session.state == .error {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Theme.amber)
                .transition(.scale(scale: 0.4).combined(with: .opacity))
        }
    }
}

/// The active-status word with a soft left-to-right "shimmer" plus an animated ellipsis.
struct WorkingLabel: View {
    let word: String

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            Text(word)
                .font(.system(size: 13.5, weight: .semibold))
                .tracking(0.1)
                .lineLimit(1)
                .overlay(alignment: .trailing) {
                    HStack(spacing: 2) {
                        ForEach(0..<3, id: \.self) { i in
                            Circle().frame(width: 2.6, height: 2.6).opacity(dotOpacity(t, i))
                        }
                    }
                    .offset(x: 13, y: 1)
                }
                .padding(.trailing, 15)
                .foregroundStyle(shimmer(t))
        }
    }

    private func dotOpacity(_ t: Double, _ i: Int) -> Double {
        let cycle = (t * 2.2).truncatingRemainder(dividingBy: 3.0)
        return 0.2 + 0.8 * max(0, 1 - abs(cycle - Double(i)))
    }

    private func shimmer(_ t: Double) -> LinearGradient {
        let period = 2.6
        let p = (t.truncatingRemainder(dividingBy: period)) / period
        let c = p * 1.4 - 0.2
        func loc(_ v: Double) -> Double { min(1, max(0, v)) }
        let dim = Color.white.opacity(0.62)
        let bright = Color.white.opacity(0.9)
        return LinearGradient(
            stops: [
                .init(color: dim,    location: 0),
                .init(color: dim,    location: loc(c - 0.3)),
                .init(color: bright, location: loc(c)),
                .init(color: dim,    location: loc(c + 0.3)),
                .init(color: dim,    location: 1),
            ],
            startPoint: .leading, endPoint: .trailing)
    }
}

/// Live elapsed clock, ticking each second.
struct TimerText: View {
    let startedAt: Double
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(elapsedString(Int(context.date.timeIntervalSince1970 - startedAt)))
        }
    }
}
