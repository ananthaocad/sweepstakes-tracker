# Jarvis: a screen watcher agent

Jarvis takes a screenshot of your screen on an interval and asks Claude whether the thing you told it to watch for is showing. When it is, you get a desktop notification.

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...      # or: ant auth login

python jarvis.py --watch "a new sweepstakes or giveaway email arrives in my inbox"
python jarvis.py --watch "the render finishes or an error dialog appears" --interval 30
python jarvis.py --watch "someone mentions me in Slack" --quiet --save-alerts alerts/
python jarvis.py --image shot.png --watch "is there an error on screen?"   # one-off test
```

## How it works

1. **Capture.** It grabs a monitor with `mss` and scales the image down to 1568px on the long edge.
2. **Change gate.** It compares the frame with the last one it sent. If almost nothing changed (score below `--threshold`), it skips the API call, which keeps costs low. A frame is still sent every `--heartbeat` seconds.
3. **Look.** It sends the frame, your watch instruction and its last 6 observations to Claude (`claude-opus-5-5`, effort `low`) and gets back structured JSON: `summary`, `alert`, `alert_message` and `confidence`. Because the observations are included, Jarvis won't alert on the same event again and again.
4. **Alert.** On an alert with confidence ≥ `--min-confidence`, it shows a native notification (macOS `osascript`, Linux `notify-send`, Windows balloon) and rings the terminal bell. Every observation is added to `jarvis_journal.jsonl`.

## Options

| Flag | Default | |
|---|---|---|
| `--watch / -w` | required | What to look for, in plain English |
| `--interval / -i` | 15 | Seconds between screenshots |
| `--threshold / -t` | 1.5 | Minimum change (0–100) before asking Claude |
| `--heartbeat` | 300 | Send a frame after this many seconds even if the screen hasn't changed (0 = off) |
| `--monitor / -m` | 1 | 1 = primary, 2 = second, 0 = all |
| `--effort` | low | `low`…`max`: how hard Claude thinks about each frame |
| `--min-confidence` | 0.6 | Alerts below this confidence are ignored |
| `--save-alerts DIR` | off | Save the screenshot that triggered each alert |
| `--once` | | Take one frame and exit |
| `--quiet / -q` | | Print alerts only |

## Privacy and cost

- Every frame Jarvis sends goes to the Anthropic API, including anything visible on that monitor (passwords, messages, banking). Point it at a dedicated monitor with `--monitor`, or stop it before you work on anything sensitive.
- Cost depends on how often your screen changes. A busy screen at the default 15s interval sends up to about 240 frames an hour. To spend less, raise `--interval` or `--threshold`.
- Jarvis has the server-side refusal fallback turned on (`fallbacks: "default"`). If a frame is declined, it is retried on a fallback model in the same call.
- On macOS, give your terminal **Screen Recording** permission (System Settings → Privacy & Security).
