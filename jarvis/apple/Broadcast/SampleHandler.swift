import CoreImage
import ReplayKit

/// Runs while the user broadcasts their screen. iOS hands us every frame; we keep one every
/// `interval` seconds and pass it to the watcher engine. Broadcast extensions have a ~50 MB
/// memory limit, so frames are scaled down on the GPU before anything else touches them.
final class SampleHandler: RPBroadcastSampleHandler {
    private var engine: WatcherEngine?
    private var interval: TimeInterval = 15
    private var lastFrame = Date.distantPast
    private let ciContext = CIContext(options: [.cacheIntermediates: false])

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        let settings = WatchSettings.load()
        guard let key = Keychain.load(), !key.isEmpty else {
            return stop("Open Jarvis and add your Anthropic API key in Settings first.")
        }
        guard !settings.watch.trimmingCharacters(in: .whitespaces).isEmpty else {
            return stop("Open Jarvis and tell it what to watch for first.")
        }
        interval = settings.interval
        engine = WatcherEngine(settings: settings, apiKey: key)
        AppGroup.defaults.set(true, forKey: "broadcastActive")
    }

    override func broadcastFinished() {
        AppGroup.defaults.set(false, forKey: "broadcastActive")
        engine = nil
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video,
              let engine,
              Date().timeIntervalSince(lastFrame) >= interval,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }
        lastFrame = Date()

        var image = CIImage(cvPixelBuffer: pixelBuffer)
        if let raw = CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString,
                                     attachmentModeOut: nil) as? NSNumber,
           let orientation = CGImagePropertyOrientation(rawValue: raw.uint32Value) {
            image = image.oriented(orientation)
        }
        let scale = min(1, CGFloat(ImageTools.maxEdge) / max(image.extent.width, image.extent.height))
        image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let frame = ciContext.createCGImage(image, from: image.extent.integral) else { return }

        Task { _ = await engine.process(frame) }
    }

    private func stop(_ reason: String) {
        AppGroup.defaults.set(false, forKey: "broadcastActive")
        finishBroadcastWithError(NSError(domain: "Jarvis", code: 1,
                                         userInfo: [NSLocalizedDescriptionKey: reason]))
    }
}
