// GET /api/photo?path=...&k=... -> streams a stored photo (the repo can stay private)
import { guard, getRaw, DATA_DIR } from './_lib/github.js';

export default async function handler(req, res) {
  if (!guard(req, res, 'GET')) return;
  const path = String(req.query.path || '');
  if (!path.startsWith(`${DATA_DIR}/photos/`) || path.includes('..') || !/\.jpe?g$/i.test(path)) {
    return res.status(400).json({ error: 'Bad photo path' });
  }
  try {
    const r = await getRaw(path);
    if (!r) return res.status(404).json({ error: 'Photo not found' });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
