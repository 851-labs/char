//
//  ContentView.swift
//  char
//
//  Created by Alexandru Turcanu on 10/12/25.
//

import SwiftUI

struct ContentView: View {
  @AppStorage(UserDefaults.Keys.text) private var text: String = "Start typing, or copy and paste your document here..."

  var body: some View {
    NavigationStack {
      MacOSScrollView {
        TextEditor(text: $text)
          .font(.body)
      }
      .navigationTitle("char")
      .navigationSubtitle("^[\(text.wordCount) word](inflect: true) • ^[\(text.characterCount) character](inflect: true)")
      .toolbarRole(.editor)
      .toolbarTitleDisplayMode(.inline)
      .modifier(StatsPresentation(text: $text))
    }
  }
}

// MARK: - MacOS ScrollView

struct MacOSScrollView<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    // content margins broken on macOS :/
    #if os(macOS)
    ScrollView {
      content
        .scrollDisabled(true)
        .scrollContentBackground(.hidden)
        .padding()
    }
    #else
    content
      .contentMargins(.horizontal, 12, for: .scrollContent)
    #endif
  }
}

// MARK: - Stats Presentation Modifier

struct StatsPresentation: ViewModifier {
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @Environment(\.isVirtualKeyboardVisible) private var isKeyboardVisible

  @Binding var text: String

  @State private var isInspectorShown: Bool = true
  @State private var isSheetShown: Bool = false
  @State private var shouldShowDoneButton: Bool = false
  @FocusState private var isTextEditorFocused: Bool

  func body(content: Content) -> some View {
    if horizontalSizeClass == .compact {
      content
        .focused($isTextEditorFocused)
        .onChange(of: isKeyboardVisible) { _, newValue in
          withAnimation {
            if newValue {
              shouldShowDoneButton = true
            } else if !isSheetShown {
              shouldShowDoneButton = false
            }
          }
        }
        .toolbar {
          ToolbarItem {
            Button(action: { isSheetShown = true }) {
              Label("Show Inspector", systemImage: "info.circle")
            }
          }
          ToolbarItem {
            Menu {
              Button(action: cutText) {
                Label("Cut", systemImage: "scissors")
              }
              .disabled(text.isEmpty)

              Button(action: copyText) {
                Label("Copy", systemImage: "doc.on.doc")
              }
              .disabled(text.isEmpty)

              Button(action: pasteText) {
                Label("Paste", systemImage: "doc.on.clipboard")
              }

              Divider()

              Button(role: .destructive, action: deleteText) {
                Label("Delete", systemImage: "trash")
              }
              .disabled(text.isEmpty)
            } label: {
              Label("More", systemImage: "ellipsis.circle")
            }
          }

          ToolbarSpacer()
          ToolbarItem(placement: .confirmationAction) {
            if shouldShowDoneButton {
              Button {
                withAnimation {
                  isTextEditorFocused = false
                  shouldShowDoneButton = false
                }
              } label: {
                Label("Done", systemImage: "checkmark")
              }
            }
          }
        }
        .sheet(isPresented: $isSheetShown) {
          NavigationStack {
            formContent
              .navigationTitle("Inspector")
              .toolbarTitleDisplayMode(.inline)
              .toolbar {
                ToolbarItem(placement: .primaryAction) {
                  Button {
                    isSheetShown = false
                  } label: {
                    Label("Close", systemImage: "xmark")
                  }
                }
              }
          }
          .presentationDetents([.fraction(0.5), .large])
        }
    } else {
      content
        .toolbar {
          ToolbarItem(placement: .primaryAction) {
            Button(action: { isInspectorShown.toggle() }) {
              Label("Toggle Inspector", systemImage: isInspectorShown ? "info.circle.fill" : "info.circle")
            }
          }
        }
        .inspector(isPresented: $isInspectorShown) {
          formContent
            .inspectorColumnWidth(min: 200, ideal: 250, max: 300)
        }
    }
  }

  private var formContent: some View {
    Form {
      Section("Statistics") {
        LabeledContent {
          Text("\(text.wordCount)")
        } label: {
          Label("Words", systemImage: "text.word.spacing")
        }

        LabeledContent {
          Text("\(text.characterCount)")
        } label: {
          Label("Characters", systemImage: "textformat")
        }

        LabeledContent {
          Text("\(text.sentenceCount)")
        } label: {
          Label("Sentences", systemImage: "text.quote")
        }

        LabeledContent {
          Text("\(text.paragraphCount)")
        } label: {
          Label("Paragraphs", systemImage: "paragraph")
        }
      }

      Section("Time") {
        LabeledContent {
          Text(text.readingTime)
        } label: {
          Label("Reading Time", systemImage: "book")
        }

        LabeledContent {
          Text(text.speakingTime)
        } label: {
          Label("Speaking Time", systemImage: "waveform")
        }
      }
    }
    .labelReservedIconWidth(16)
  }

  // MARK: - Text Actions

  private func copyText() {
    Clipboard.copy(text)
  }

  private func cutText() {
    Clipboard.copy(text)
    text = ""
  }

  private func pasteText() {
    if let pastedText = Clipboard.paste() {
      text = pastedText
    }
  }

  private func deleteText() {
    text = ""
  }
}

#Preview {
  ContentView()
}
