import SwiftUI
import IslandCore

/// Visual constants. Springs are tuned to read as "Apple": a snappy morph on expand with
/// the barest overshoot, a slightly faster collapse so dismissal feels crisp, and a
/// content cross-fade that lags the shape by a hair so content appears to grow out of
/// the pill.
///
/// `appear`/`disappear` drive the whole-island reveal/retract (`notchReveal` in
/// IslandView). Their settle time (~0.73 * response / dampingFraction) must stay in
/// step with the asyncAfter delays in AppController that flip `opening`/`isVisible` —
/// tune both together.
enum Theme {
    static let expand    = Animation.spring(response: 0.42, dampingFraction: 0.86)
    static let appear    = Animation.spring(response: 0.48, dampingFraction: 0.8)
    static let disappear = Animation.spring(response: 0.34, dampingFraction: 1.0)

    // The pill body — pure, flat black so it fuses seamlessly with the physical notch.
    // Override with ISLAND_PILL: a grayscale value 0.0-1.0, or a hex string like #0A0A0F.
    static let pill: Color = {
        let env = ProcessInfo.processInfo.environment["ISLAND_PILL"]?.trimmingCharacters(in: .whitespaces) ?? ""
        if env.hasPrefix("#"), let c = Color(hexString: env) { return c }
        if let w = Double(env), (0...1).contains(w) { return Color(.sRGB, white: w, opacity: 1) }
        return .black
    }()

    static let amber = Color(.sRGB, red: 0.96, green: 0.74, blue: 0.18, opacity: 1)
    static let green = Color(.sRGB, red: 0.16, green: 0.78, blue: 0.45, opacity: 1)

    static let wing: CGFloat = 56
    static let dropHeight: CGFloat = 54

    static let sessionRowHeight: CGFloat = 28
    static let sessionRowSpacing: CGFloat = 2
    static let sessionRowsVisible = 3
    static func stackDropHeight(_ count: Int) -> CGFloat {
        let full = CGFloat(min(max(count, 1), sessionRowsVisible))
        if count > sessionRowsVisible {
            return 7 + full * (sessionRowHeight + sessionRowSpacing) + sessionRowHeight * 0.65
        }
        return 7 + full * sessionRowHeight + (full - 1) * sessionRowSpacing + 9
    }

    static func accent(_ provider: Provider) -> Color {
        let c = provider.accentRGB
        return Color(.sRGB, red: c.r, green: c.g, blue: c.b, opacity: 1)
    }
}

extension Color {
    init?(hexString: String) {
        var s = hexString
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = Int(s, radix: 16) else { return nil }
        self = Color(.sRGB,
                     red: Double((v >> 16) & 0xFF) / 255,
                     green: Double((v >> 8) & 0xFF) / 255,
                     blue: Double(v & 0xFF) / 255,
                     opacity: 1)
    }
}

/// "0:43" / "1:05" / "12:30" — a compact, single-line media-style clock.
func elapsedString(_ seconds: Int) -> String {
    let s = max(0, seconds)
    return String(format: "%d:%02d", s / 60, s % 60)
}
