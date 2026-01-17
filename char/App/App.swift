//
//  charApp.swift
//  char
//
//  Created by Alexandru Turcanu on 10/12/25.
//

import Sparkle
import SwiftUI

@main
struct charApp: App {
  private let updaterController = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)

  var body: some Scene {
    WindowGroup {
      ContentView()
        .trackVirtualKeyboard()
    }
    .commands {
      InspectorCommands()
      CommandGroup(after: .appInfo) {
        Button {
          updaterController.checkForUpdates(nil)
        } label: {
          Label("Check for Updates…", systemImage: "square.and.arrow.down")
        }
      }
    }
  }
}
