import Combine
import ReplayKit
import SwiftUI
import UserNotifications

@main
struct JarvisiOSApp: App {
    init() {
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }

    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @State private var observations = ObservationLog.recent()
    @State private var broadcasting = AppGroup.defaults.bool(forKey: "broadcastActive")
    @State private var showSettings = false
    @State private var settings = WatchSettings.load()
    private let refresh = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        BroadcastPicker()
                            .frame(width: 56, height: 56)
                            .background(Circle().fill(broadcasting ? Color.red.opacity(0.15) : Color.accentColor.opacity(0.15)))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(broadcasting ? "Jarvis is watching" : "Start watching")
                                .font(.headline)
                            Text(settings.watch.isEmpty ? "Set what to watch for in Settings first." : settings.watch)
                                .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    .padding(.vertical, 6)
                } footer: {
                    Text("Tap the button, then **Start Broadcast**. Jarvis keeps watching your whole screen while you use other apps. Stop it from the red indicator or Control Center. Screen frames are sent to the Anthropic API.")
                }

                Section("Recent") {
                    if observations.isEmpty {
                        Text("No observations yet.").foregroundStyle(.secondary)
                    }
                    ForEach(observations) { ObservationRow(observation: $0) }
                }
            }
            .navigationTitle("Jarvis")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear") { ObservationLog.clear(); observations = [] }
                        .disabled(observations.isEmpty)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .sheet(isPresented: $showSettings, onDismiss: { settings = WatchSettings.load() }) {
                NavigationStack {
                    SettingsForm()
                        .navigationTitle("Settings")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { Button("Done") { showSettings = false } }
                }
            }
        }
        .task { await Notifier.requestPermission() }
        .onReceive(refresh) { _ in
            observations = ObservationLog.recent()
            broadcasting = AppGroup.defaults.bool(forKey: "broadcastActive")
        }
    }
}

/// The system "start broadcast" button, pre-selected to Jarvis's extension.
struct BroadcastPicker: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 56, height: 56))
        picker.preferredExtension = (Bundle.main.bundleIdentifier ?? "") + ".Broadcast"
        picker.showsMicrophoneButton = false
        return picker
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}
