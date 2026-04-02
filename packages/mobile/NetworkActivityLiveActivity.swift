// NetworkActivityLiveActivity.swift
// SwiftUI views and widget configuration for the NetworkActivity Live Activity.

import SwiftUI
import ActivityKit
import WidgetKit

@available(iOS 16.1, *)
struct NetworkActivityLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NetworkActivityAttributes.self) { context in
            // Lock Screen / Banner presentation
            LiveActivityExpandedView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ProgressIcon(progress: context.state.progress)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(context.attributes.title).font(.headline)
                        Text(context.state.status).font(.subheadline)
                        ProgressView(value: context.state.progress)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let eta = context.state.eta {
                        Text(eta, style: .timer)
                            .monospacedDigit()
                            .font(.subheadline)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let error = context.state.errorDescription, !error.isEmpty {
                        Text(error).font(.footnote)
                    }
                }
            } compactLeading: {
                ProgressIcon(progress: context.state.progress)
            } compactTrailing: {
                Text(Int(context.state.progress * 100)).bold().font(.caption)
            } minimal: {
                ProgressIcon(progress: context.state.progress)
            }
        }
    }
}

@available(iOS 16.1, *)
private struct LiveActivityExpandedView: View {
    let context: ActivityViewContext<NetworkActivityAttributes>
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(context.attributes.title).font(.headline)
                Spacer()
                if let eta = context.state.eta {
                    Text(eta, style: .timer).monospacedDigit().font(.subheadline)
                }
            }
            Text(context.state.status).font(.subheadline)
            ProgressView(value: context.state.progress)
            if let error = context.state.errorDescription, !error.isEmpty {
                Text(error).font(.footnote)
            }
        }
        .padding()
    }
}

@available(iOS 16.1, *)
private struct ProgressIcon: View {
    let progress: Double
    var body: some View {
        ZStack {
            Circle().stroke(lineWidth: 3).opacity(0.25)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: 22, height: 22)
    }
}

@available(iOS 16.1, *)
struct NetworkActivityLiveActivity_Previews: PreviewProvider {
    static var previews: some View {
        LiveActivityExpandedView(context: .init(
            attributes: NetworkActivityAttributes(taskID: "demo", title: "Transfer"),
            state: NetworkActivityAttributes.ContentState(status: "Uploading", progress: 0.42, eta: Date().addingTimeInterval(300), errorDescription: nil)))
    }
}
