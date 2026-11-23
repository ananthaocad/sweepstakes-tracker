# Jarvis for Mac, iPhone and iPad

These are native SwiftUI versions of the Jarvis screen watcher. They use the same agent as `../jarvis.py`: Jarvis screenshots your screen, skips frames that haven't changed, asks Claude whether what you're watching for is on screen, and sends you a notification when it is.

| | How it watches |
|---|---|
| **Mac** (macOS 14+) | A menu bar app plus a window. It captures the main display with ScreenCaptureKit and hides its own windows from the capture. |
| **iPhone / iPad** (iOS 17+) | iOS doesn't let apps capture the screen silently. Jarvis uses a **screen broadcast extension**: you tap Start Broadcast, and Jarvis watches your whole screen across all apps until you stop it. A red indicator shows while it runs. |

## Install (on your Mac)

You need **Xcode 15 or later** and an Apple ID. A free account works for your own devices, but apps installed that way expire after 7 days and have to be run again from Xcode.

```bash
cd jarvis/apple
./setup.sh            # installs XcodeGen via Homebrew if needed, generates and opens Jarvis.xcodeproj
```

Then in Xcode:

1. **Signing.** Click the project, and for each of the 3 targets (`JarvisMac`, `JarvisiOS`, `JarvisBroadcast`) open *Signing & Capabilities* and choose your **Team**. If Xcode says a bundle ID is taken, rerun with your own prefix, for example `JARVIS_BUNDLE_PREFIX=com.yourname.jarvisapp ./setup.sh`.
2. **Mac app.** Pick the `JarvisMac` scheme and *My Mac*, then press ⌘R. The first time you start watching, macOS asks for **Screen Recording** permission. Allow it, then quit and reopen Jarvis.
3. **iPhone / iPad.** Plug in the device (or pair it over Wi-Fi), pick the `JarvisiOS` scheme and your device, then press ⌘R.
   - On the device, turn on **Settings › Privacy & Security › Developer Mode** (it restarts the device).
   - With a free account, also trust yourself under **Settings › General › VPN & Device Management**.
   - Run it once for the iPhone and once for the iPad.

## Use

1. Open Jarvis, then go to **Settings**. Enter what to watch for (for example "a new sweepstakes or giveaway email arrives") and your Anthropic API key. The key is stored in the device Keychain.
2. **Mac:** click **Start watching** (or use the 👁 menu bar icon).
   **iOS:** tap the round button, then **Start Broadcast**, then switch to whatever app you want watched.
3. Alerts arrive as notifications. The Recent list shows each observation.

## Things to know

- **Privacy:** every frame Jarvis sends goes to the Anthropic API. Stop it before you open banking, passwords or private messages.
- **Cost:** frames are only sent when the screen changes, at most once per interval (default 15s). To spend less, raise the interval or the change sensitivity.
- **iOS limits:** watching stops when the device locks, and iOS ends the broadcast if the extension goes over its ~50 MB memory limit. Jarvis downsizes frames to stay well under it.
- **App Groups:** the iPhone app and its broadcast extension share settings through an App Group. If Xcode says your Personal Team can't use App Groups, you'll need the paid Apple Developer Program ($99/yr), which also removes the 7-day expiry.
- **Model:** `claude-opus-5-5` at low effort, with the server-side refusal fallback turned on. Effort can be changed in Settings.

## Layout

```
project.yml            XcodeGen spec (3 targets)
Shared/                Claude client, settings/Keychain/log, the WatcherEngine agent
SharedUI/              Settings form + observation row (used by Mac and iOS)
Mac/                   Menu bar app + ScreenCaptureKit capture
iOS/                   iPhone/iPad app + broadcast picker
Broadcast/             ReplayKit broadcast extension that watches the screen
```
