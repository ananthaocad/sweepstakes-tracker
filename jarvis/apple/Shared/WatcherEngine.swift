import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import UserNotifications

enum ImageTools {
    /// Long edge sent to Claude; larger images get downscaled server-side anyway.
    static let maxEdge = 1568

    static func downscale(_ img: CGImage, maxEdge: Int = maxEdge) -> CGImage {
        let scale = min(1, Double(maxEdge) / Double(max(img.width, img.height)))
        guard scale < 1 else { return img }
        let w = Int(Double(img.width) * scale), h = Int(Double(img.height) * scale)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return img }
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage() ?? img
    }

    static func jpeg(_ img: CGImage, quality: Double = 0.8) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return data as Data
    }

    /// 160x90 grayscale thumbnail used to detect whether the screen changed.
    static func thumbnail(_ img: CGImage) -> [UInt8] {
        let w = 160, h = 90
        var pixels = [UInt8](repeating: 0, count: w * h)
        pixels.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(),
                                      bitmapInfo: CGImageAlphaInfo.none.rawValue)
            else { return }
            ctx.interpolationQuality = .low
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        return pixels
    }

    /// 0...100 mean per-pixel difference. Cursor blinks and clock ticks score well under 1.
    static func changeScore(_ a: [UInt8]?, _ b: [UInt8]) -> Double {
        guard let a, a.count == b.count, !b.isEmpty else { return 100 }
        var sum = 0
        for i in 0..<b.count { sum += abs(Int(a[i]) - Int(b[i])) }
        return Double(sum) / Double(b.count) / 255 * 100
    }
}

enum Notifier {
    static func requestPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }

    static func post(_ message: String) {
        let content = UNMutableNotificationContent()
        content.title = "Jarvis"
        content.body = message
        content.sound = .default
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}

/// Shows banners even while Jarvis itself is in the foreground.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }
}

/// The agent: gates on screen change, asks Claude, remembers recent observations, alerts.
actor WatcherEngine {
    enum Outcome {
        case skipped
        case observed(Observation)
        case failed(String)
    }

    private let settings: WatchSettings
    private let client: ClaudeClient
    private var history: [Observation] = []
    private var lastThumb: [UInt8]?
    private var lastSent = Date.distantPast
    private var pausedUntil = Date.distantPast
    private var busy = false

    init(settings: WatchSettings, apiKey: String) {
        self.settings = settings
        self.client = ClaudeClient(apiKey: apiKey, model: settings.model, effort: settings.effort)
    }

    func process(_ image: CGImage) async -> Outcome {
        let now = Date()
        guard !busy, now >= pausedUntil else { return .skipped }

        let small = ImageTools.downscale(image)
        let thumb = ImageTools.thumbnail(small)
        let change = ImageTools.changeScore(lastThumb, thumb)
        let stale = settings.heartbeat > 0 && now.timeIntervalSince(lastSent) >= settings.heartbeat
        guard change >= settings.threshold || stale else { return .skipped }
        guard let jpeg = ImageTools.jpeg(small) else { return .failed("Couldn't encode screenshot") }

        busy = true
        defer { busy = false }
        lastThumb = thumb
        lastSent = now

        do {
            let v = try await client.look(jpeg: jpeg, prompt: prompt(at: now))
            let obs = Observation(date: now, summary: v.summary, alert: v.alert,
                                  alertMessage: v.alert_message, confidence: v.confidence)
            history.append(obs)
            if history.count > 6 { history.removeFirst(history.count - 6) }
            ObservationLog.append(obs)
            if obs.alert && obs.confidence >= settings.minConfidence {
                Notifier.post(obs.alertMessage)
            }
            return .observed(obs)
        } catch ClaudeError.rateLimited(let wait) {
            pausedUntil = Date().addingTimeInterval(wait)
            return .failed(ClaudeError.rateLimited(retryAfter: wait).localizedDescription)
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    private func prompt(at date: Date) -> String {
        let fmt = DateFormatter()
        fmt.timeStyle = .medium
        let past = history.isEmpty
            ? "(none yet - this is the first screenshot)"
            : history.map { o in
                "- \(fmt.string(from: o.date)): \(o.summary)" + (o.alert ? " [ALERTED: \(o.alertMessage)]" : "")
            }.joined(separator: "\n")
        return """
        Watch instruction: \(settings.watch)

        Your recent observations:
        \(past)

        Current time: \(fmt.string(from: date)). Here is the latest screenshot.
        """
    }
}
