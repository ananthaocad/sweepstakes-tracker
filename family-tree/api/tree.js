// GET /api/tree -> the organized family tree (data/tree.json)
import { guard, getRaw, DATA_DIR } from './_lib/github.js';

export default async function handler(req, res) {
  if (!guard(req, res, 'GET')) return;
  try {
    const r = await getRaw(`${DATA_DIR}/tree.json`);
    const tree = r ? await r.json() : { people: [], photos: [], submissionToPerson: {}, stats: {} };
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(tree);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
