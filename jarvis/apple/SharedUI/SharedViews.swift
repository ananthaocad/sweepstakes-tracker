import SwiftUI

struct SettingsForm: View {
    @State private var settings = WatchSettings.load()
    @State private var apiKey = Keychain.load() ?? ""

    var body: some View {
        Form {
            Section("What should Jarvis watch for?") {
                TextField("e.g. a new sweepstakes email arrives", text: $settings.watch, axis: .vertical)
                    .lineLimit(2...5)
            }

            Section {
                SecureField("sk-ant-…", text: $apiKey)
                    .textContentType(.password)
                    .autocorrectionDisabled()
            } header: {
                Text("Anthropic API key")
            } footer: {
                Text("Stored in this device's Keychain. Screenshots are sent to the Anthropic API — avoid watching sensitive screens.")
            }

            Section("Tuning") {
                Stepper("Check every \(Int(settings.interval))s", value: $settings.interval, in: 5...600, step: 5)
                Picker("Effort", selection: $settings.effort) {
                    ForEach(["low", "medium", "high"], id: \.self) { Text($0.capitalized).tag($0) }
                }
                VStack(alignment: .leading) {
                    Text("Change sensitivity: \(settings.threshold, specifier: "%.1f")")
                    Slider(value: $settings.threshold, in: 0.5...10)
                    Text("Lower = sends more frames to Claude (costs more).")
                        .font(.caption).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading) {
                    Text("Alert at confidence ≥ \(Int(settings.minConfidence * 100))%")
                    Slider(value: $settings.minConfidence, in: 0.3...1)
                }
            }
        }
        .onChange(of: settings) { _, new in new.save() }
        .onChange(of: apiKey) { _, new in Keychain.save(new.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }
}

struct ObservationRow: View {
    let observation: Observation

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: observation.alert ? "bell.badge.fill" : "eye")
                .foregroundStyle(observation.alert ? .orange : .secondary)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(observation.alert ? observation.alertMessage : observation.summary)
                    .fontWeight(observation.alert ? .semibold : .regular)
                if observation.alert {
                    Text(observation.summary).font(.caption).foregroundStyle(.secondary)
                }
                Text("\(observation.date.formatted(date: .omitted, time: .standard)) · \(Int(observation.confidence * 100))% sure")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }
}
