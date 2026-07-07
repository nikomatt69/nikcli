import SwiftUI
import IslandCore

/// The real nikcli wordmark (Resources/wordmark.png — the "light" export from
/// packages/mobile/assets, chosen because it reads white-on-transparent, the only
/// variant that survives on the pill's solid black). Shown centered in the expanded
/// drop-down in place of the plain accent divider.
enum WordmarkAsset {
    static let image: NSImage? = Bundle.module
        .url(forResource: "wordmark", withExtension: "png")
        .flatMap { NSImage(contentsOf: $0) }
}

/// nikcli's identity mark. Unlike Pookify (which ships baked pixel-art/PNG frames for
/// Claude's spark and the Clawd crab), this is a purely procedural glyph — an SF Symbol
/// code-bracket monogram with a soft "breathing" ring while the agent is actively
/// working, static otherwise. No bitmap assets to source or embed.
///
/// Driven by `TimelineView` at a throttled rate (like Pookify's shimmer/timer), not
/// implicit SwiftUI animation, so it costs a redraw at ~15fps instead of every frame.
struct AgentGlyph: View {
    let provider: Provider
    var working: Bool = true
    var size: CGFloat = 18

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !working)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            // A continuous sine breathing cycle (not a sawtooth ramp-then-snap): the ring
            // expands and fades out smoothly, then the *next* cycle's ring starts from
            // scratch while the first is still fully transparent, so the wrap is invisible.
            let period = 1.8
            let raw = (t.truncatingRemainder(dividingBy: period)) / period      // 0...1, still a ramp
            let eased = 1 - pow(1 - raw, 2)                                     // ease-out: fast start, gentle finish
            ZStack {
                if working {
                    Circle()
                        .stroke(Theme.accent(provider).opacity(0.55 * (1 - eased)), lineWidth: 1.3)
                        .scaleEffect(0.68 + eased * 0.75)
                    // A faint static glow under the mark reads as "alive" even at the instant
                    // the ring resets, so the breathing never looks like it stutters.
                    Circle()
                        .fill(Theme.accent(provider).opacity(0.14))
                        .frame(width: size * 0.62, height: size * 0.62)
                }
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                    .font(.system(size: size * 0.56, weight: .semibold))
                    .foregroundStyle(Theme.accent(provider))
            }
            .frame(width: size, height: size)
        }
        .frame(width: size, height: size)
    }
}
