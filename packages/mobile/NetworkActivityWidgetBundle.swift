// NetworkActivityWidgetBundle.swift
// Widget bundle entry point for NetworkActivity widgets (including Live Activity).

import WidgetKit
import SwiftUI

@main
struct NetworkActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            NetworkActivityLiveActivity()
        }
    }
}
