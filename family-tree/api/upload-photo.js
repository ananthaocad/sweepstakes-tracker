// POST /api/upload-photo { image: "data:image/jpeg;base64,..." } -> { path }
// The browser already shrinks photos to ~1600px JPEGs before sending them.
import { guard, createFile, DATA_DIR, randomId } from './_lib/github.js';

const MAX_BYTES = 3 * 1024 * 1024;

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;
  const image = req.body && req.body.image;
  const m = typeof image === 'string' && image.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Please send a JPEG image.' });
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'Photo is too large.' });
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return res.status(400).json({ error: 'Not a valid JPEG.' });

  const now = new Date();
  const path = `${DATA_DIR}/photos/${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomId('')}.jpg`;
  try {
    await createFile(path, m[1], 'Add family photo');
    res.status(200).json({ path });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
