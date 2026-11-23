import Foundation
import Security

/// The App Group shared by the iOS app and its screen-broadcast extension.
enum AppGroup {
    static var id: String {
        Bundle.main.object(forInfoDictionaryKey: "JarvisAppGroup") as? String ?? "group.jarvis"
    }

    #if os(iOS)
    static var defaults: UserDefaults { UserDefaults(suiteName: id) ?? .standard }
    #else
    // The Mac app has no extension to share with, so it uses its own storage.
    static var defaults: UserDefaults { .standard }
    #endif

    static var containerURL: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Jarvis", isDirectory: true)
        #if os(iOS)
        let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) ?? appSupport
        #else
        let url = appSupport
        #endif
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

struct WatchSettings: Codable, Equatable {
    var watch: String = ""
    var interval: Double = 15        // seconds between screenshots
    var threshold: Double = 1.5      // minimum screen change (0-100) before asking Claude
    var heartbeat: Double = 300      // look anyway after this many seconds of a static screen
    var effort: String = "low"
    var minConfidence: Double = 0.6
    var model: String = "claude-opus-5-5"

    private static let key = "watchSettings"

    static func load() -> WatchSettings {
        guard let data = AppGroup.defaults.data(forKey: key),
              let s = try? JSONDecoder().decode(WatchSettings.self, from: data)
        else { return WatchSettings() }
        return s
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) {
            AppGroup.defaults.set(data, forKey: Self.key)
        }
    }
}

/// API key lives in the Keychain. On iOS it uses the App Group as the access group so the
/// broadcast extension can read it.
enum Keychain {
    private static func baseQuery() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "jarvis.anthropic",
            kSecAttrAccount as String: "api-key",
        ]
        #if os(iOS)
        q[kSecAttrAccessGroup as String] = AppGroup.id
        #endif
        return q
    }

    static func save(_ key: String) {
        SecItemDelete(baseQuery() as CFDictionary)
        guard !key.isEmpty else { return }
        var q = baseQuery()
        q[kSecValueData as String] = Data(key.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    static func load() -> String? {
        var q = baseQuery()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

struct Observation: Codable, Identifiable, Hashable {
    var id = UUID()
    var date: Date
    var summary: String
    var alert: Bool
    var alertMessage: String
    var confidence: Double
}

/// Append-only log in the shared container, so the iOS app can show what the extension saw.
enum ObservationLog {
    private static var url: URL { AppGroup.containerURL.appendingPathComponent("observations.jsonl") }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e
    }()
    private static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d
    }()

    static func append(_ o: Observation) {
        guard var line = try? encoder.encode(o) else { return }
        line.append(0x0A)
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: line)
        } else {
            try? line.write(to: url, options: .atomic)
        }
    }

    /// Newest first.
    static func recent(limit: Int = 200) -> [Observation] {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").suffix(limit).reversed().compactMap {
            try? decoder.decode(Observation.self, from: Data($0.utf8))
        }
    }

    static func clear() { try? FileManager.default.removeItem(at: url) }
}
