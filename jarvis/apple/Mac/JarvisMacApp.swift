import ScreenCaptureKit
import SwiftUI
import UserNotifications

@main
struct JarvisMacApp: App {
    @StateObject private var watcher = MacWatcher()

    init() {
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    }

    var body: some Scene {
        Window("Jarvis", id: "main") {
            ContentView().environmentObject(watcher)
                .frame(minWidth: 760, minHeight: 480)
        }

        MenuBarExtra {
            MenuContent().environmentObject(watcher)
        } label: {
            Image(systemName: watcher.running ? "eye.fill" : "eye")
        }
    }
}

enum ScreenGrabber {
    struct NoDisplay: LocalizedError { var errorDescription: String? { "No display found." } }

    /// Captures the main display, hiding Jarvis's own windows.
    static func capture() async throws -> CGImage {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let mainID = CGMainDisplayID()
        guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first
        else { throw NoDisplay() }
        let mine = content.applications.filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier }
        let filter = SCContentFilter(display: display, excludingApplications: mine, exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.width = display.width
        config.height = display.height
        config.showsCursor = false
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }
}

@MainActor
final class MacWatcher: ObservableObject {
    @Published var running = false
    @Published var status = "Idle"
    @Published var observations: [Observation] = ObservationLog.recent()

    private var task: Task<Void, Never>?

    func start() {
        guard let key = Keychain.load(), !key.isEmpty else {
            status = "Add your Anthropic API key in Settings first."
            return
        }
        let settings = WatchSettings.load()
        guard !settings.watch.trimmingCharacters(in: .whitespaces).isEmpty else {
            status = "Tell Jarvis what to watch for first."
            return
        }

        Task { await Notifier.requestPermission() }
        let engine = WatcherEngine(settings: settings, apiKey: key)
        running = true
        status = "Watching for: \(settings.watch)"

        task = Task { [weak self] in
            while !Task.isCancelled {
                let started = Date()
                do {
                    let image = try await ScreenGrabber.capture()
                    let outcome = await engine.process(image)
                    self?.handle(outcome)
                } catch {
                    self?.status = "Screen capture failed — allow Jarvis under System Settings › Privacy & Security › Screen Recording, then restart it. (\(error.localizedDescription))"
                }
                let wait = max(1, settings.interval - Date().timeIntervalSince(started))
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        running = false
        status = "Idle"
    }

    func clearLog() {
        ObservationLog.clear()
        observations = []
    }

    private func handle(_ outcome: WatcherEngine.Outcome) {
        switch outcome {
        case .skipped: break
        case .observed(let o):
            observations.insert(o, at: 0)
            status = o.alert ? "🔔 \(o.alertMessage)" : "👁 \(o.summary)"
        case .failed(let message):
            status = message
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var watcher: MacWatcher

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: watcher.running ? "eye.fill" : "eye")
                    .foregroundStyle(watcher.running ? .green : .secondary)
                Text(watcher.status).lineLimit(2).foregroundStyle(.secondary)
                Spacer()
                Button(watcher.running ? "Stop" : "Start watching") {
                    watcher.running ? watcher.stop() : watcher.start()
                }
                .keyboardShortcut(.return, modifiers: .command)
                .buttonStyle(.borderedProminent)
                .tint(watcher.running ? .red : .accentColor)
            }
            .padding()
            Divider()
            HStack(spacing: 0) {
                SettingsForm()
                    .formStyle(.grouped)
                    .frame(width: 360)
                    .disabled(watcher.running)
                Divider()
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text("Observations").font(.headline)
                        Spacer()
                        Button("Clear") { watcher.clearLog() }.buttonStyle(.link)
                    }
                    .padding([.horizontal, .top])
                    if watcher.observations.isEmpty {
                        ContentUnavailableView("Nothing yet", systemImage: "eye",
                                               description: Text("Start watching and Jarvis's observations will appear here."))
                    } else {
                        List(watcher.observations) { ObservationRow(observation: $0) }
                    }
                }
            }
        }
    }
}

struct MenuContent: View {
    @EnvironmentObject var watcher: MacWatcher
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Text(watcher.running ? "Watching" : "Idle")
        if let last = watcher.observations.first {
            Text(last.alert ? "🔔 \(last.alertMessage)" : last.summary)
        }
        Divider()
        Button(watcher.running ? "Stop watching" : "Start watching") {
            watcher.running ? watcher.stop() : watcher.start()
        }
        Button("Open Jarvis…") {
            openWindow(id: "main")
            NSApp.activate(ignoringOtherApps: true)
        }
        Divider()
        Button("Quit Jarvis") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
