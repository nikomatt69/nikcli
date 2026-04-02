// NetworkActivityAttributes.swift
// Defines ActivityKit attributes and content state for networking-related Live Activities.

import Foundation
import ActivityKit

public struct NetworkActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var status: String
        public var progress: Double // 0.0 ... 1.0
        public var eta: Date?
        public var errorDescription: String?
        
        public init(status: String, progress: Double, eta: Date? = nil, errorDescription: String? = nil) {
            self.status = status
            self.progress = max(0.0, min(1.0, progress))
            self.eta = eta
            self.errorDescription = errorDescription
        }
    }
    
    public var taskID: String
    public var title: String
    
    public init(taskID: String, title: String) {
        self.taskID = taskID
        self.title = title
    }
}
