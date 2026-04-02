// LiveActivityManager.swift
// Provides a simple interface to start, update, and end a Live Activity for networking tasks.

import Foundation
import ActivityKit

@objcMembers
public class LiveActivityManager: NSObject {
    // We store activities as Any to avoid referencing Activity<T> in signatures outside availability blocks.
    private static var activities: [String: Any] = [:] // key: taskID, value: Activity<NetworkActivityAttributes>
    private static var lastUpdateDate: [String: Date] = [:]
    private static var lastProgressValue: [String: Double] = [:]
    
    // Start a Live Activity for a given taskID and title. Returns true on success.
    @discardableResult
    public static func startActivity(taskID: String, title: String, initialStatus: String = "Starting", initialProgress: Double = 0.0) -> Bool {
        // If ActivityKit is not available, return false gracefully.
        if #available(iOS 16.1, *) {
            // Check authorization
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
            let attributes = NetworkActivityAttributes(taskID: taskID, title: title)
            let content = NetworkActivityAttributes.ContentState(status: initialStatus, progress: initialProgress)
            do {
                let activity = try Activity<NetworkActivityAttributes>.request(attributes: attributes, contentState: content, pushType: .token)
                activities[taskID] = activity as Any
                return true
            } catch {
                return false
            }
        } else {
            return false
        }
    }
    
    // Update progress/state for the given taskID.
    public static func updateActivity(taskID: String, status: String, progress: Double, eta: Date? = nil, errorDescription: String? = nil) {
        // Throttle updates: at most 5 per second or significant progress change
        let now = Date()
        let lastDate = lastUpdateDate[taskID]
        let lastProgress = lastProgressValue[taskID] ?? -1
        let timeOK = (lastDate == nil) || (now.timeIntervalSince(lastDate!) >= 0.2)
        let progressOK = abs(progress - lastProgress) >= 0.02 || lastProgress < 0
        guard timeOK || progressOK else { return }
        lastUpdateDate[taskID] = now
        lastProgressValue[taskID] = progress
        
        if #available(iOS 16.1, *) {
            guard let anyActivity = activities[taskID] as? Activity<NetworkActivityAttributes> else { return }
            let state = NetworkActivityAttributes.ContentState(status: status, progress: progress, eta: eta, errorDescription: errorDescription)
            Task {
                await anyActivity.update(using: state)
            }
        } else {
            // No-op on older systems
            return
        }
    }
    
    // End the activity with a final state. If success is false, include an error description in state.
    public static func endActivity(taskID: String, finalStatus: String = "Completed", success: Bool = true, errorDescription: String? = nil) {
        lastUpdateDate.removeValue(forKey: taskID)
        lastProgressValue.removeValue(forKey: taskID)
        
        if #available(iOS 16.1, *) {
            guard let anyActivity = activities.removeValue(forKey: taskID) as? Activity<NetworkActivityAttributes> else { return }
            let state = NetworkActivityAttributes.ContentState(status: finalStatus, progress: success ? 1.0 : 0.0, eta: nil, errorDescription: errorDescription)
            Task {
                await anyActivity.end(using: state, dismissalPolicy: success ? .immediate : .default)
            }
        } else {
            // No-op on older systems
            return
        }
    }
    
    // Expose a convenience method for Objective-C to update numeric progress (0..1) with a status string.
    public static func updateProgress(taskID: String, progress: Double, status: String) {
        updateActivity(taskID: taskID, status: status, progress: progress)
    }
}
