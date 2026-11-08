// POST /api/submit { submission } -> stores data/submissions/<id>.json and returns { id }.
// The GitHub Action then merges it into data/tree.json.
import { guard, createFile, DATA_DIR, randomId } from './_lib/github.js';

const s = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const rel = r => (r && typeof r === 'object' && s(r.name) ? { name: s(r.name, 120), deceased: r.deceased === true, notes: s(r.notes, 1000) } : null);
const list = v => (Array.isArray(v) ? v.slice(0, 30).map(x => rel(typeof x === 'string' ? { name: x } : x)).filter(Boolean) : []);

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;
  const b = (req.body && req.body.submission) || {};
  if (!s(b.self && b.self.name)) return res.status(400).json({ error: 'Please tell us your name.' });

  const photoOk = p => typeof p === 'string' && p.startsWith(`${DATA_DIR}/photos/`) && !p.includes('..');
  const id = randomId('s_');
  const submission = {
    id,
    submittedAt: new Date().toISOString(),
    clientId: s(b.clientId, 64) || null,
    invitedBy: s(b.invitedBy, 64) || null,
    self: {
      name: s(b.self.name, 120),
      gender: ['male', 'female'].includes(b.self.gender) ? b.self.gender : null,
      birthYear: s(String(b.self.birthYear || ''), 4),
      location: s(b.self.location),
      birthPlace: s(b.self.birthPlace),
      about: s(b.self.about, 2000),
    },
    father: rel(b.father),
    mother: rel(b.mother),
    fatherParents: { father: rel(b.fatherParents && b.fatherParents.father), mother: rel(b.fatherParents && b.fatherParents.mother) },
    motherParents: { father: rel(b.motherParents && b.motherParents.father), mother: rel(b.motherParents && b.motherParents.mother) },
    spouse: rel(b.spouse),
    siblings: list(b.siblings),
    children: list(b.children),
    origins: s(b.origins, 3000),
    profilePhoto: photoOk(b.profilePhoto) ? b.profilePhoto : null,
    photos: (Array.isArray(b.photos) ? b.photos : []).slice(0, 30).filter(p => p && photoOk(p.path)).map(p => ({
      path: p.path,
      caption: s(p.caption, 500),
      tags: (Array.isArray(p.tags) ? p.tags : []).slice(0, 40).filter(t => t && s(t.name)).map(t => ({
        name: s(t.name, 120),
        self: t.self === true,
        x: typeof t.x === 'number' ? t.x : null,
        y: typeof t.y === 'number' ? t.y : null,
      })),
    })),
  };

  const slug = submission.self.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'person';
  const content = Buffer.from(JSON.stringify(submission, null, 2)).toString('base64');
  try {
    await createFile(`${DATA_DIR}/submissions/${submission.submittedAt.slice(0, 10)}-${slug}-${id}.json`, content, `New family tree entry: ${submission.self.name}`);
    res.status(200).json({ id });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
