// Admin-only decisions for investigation missions. Requires header x-admin-key = ADMIN_KEY.
//   GET  /api/resolve                -> { admin: true|false }   (checks the admin link)
//   POST /api/resolve { resolution } -> stores data/resolutions/<id>.json
//     fact:      { missionId, type: 'fact',      decision: { value } }
//     story:     { missionId, type: 'story',     decision: { main: storyId } }
//     verify:    { missionId, type: 'verify',    decision: { storyId, status: 'verified'|'disputed'|'unverified' } }
//     parents:   { missionId, type: 'parents',   decision: { personId, keep: [parentIds] } }
//     duplicate: { missionId, type: 'duplicate', decision: { same: true|false, personIds: [a, b], names: [..] } }
//     any type:  decision: { reopen: true } undoes the previous decision
import { timingSafeEqual } from 'node:crypto';
import { guard, createFile, DATA_DIR, randomId } from './_lib/github.js';
import { s, id } from './_lib/clean.js';

function isAdmin(req) {
  const given = String(req.headers['x-admin-key'] || '');
  const expected = String(process.env.ADMIN_KEY || '');
  return !!expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const ids = (v, prefix) => (Array.isArray(v) ? v.slice(0, 10).map(x => id(x, prefix)).filter(Boolean) : []);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!guard(req, res, 'GET')) return;
    return res.status(200).json({ admin: isAdmin(req) });
  }
  if (!guard(req, res, 'POST')) return;
  if (!isAdmin(req)) return res.status(403).json({ error: 'Only admins can choose the main entry. Open the admin link first.' });

  const b = (req.body && req.body.resolution) || {};
  const d = b.decision || {};
  const missionId = id(b.missionId, 'm_');
  if (!missionId) return res.status(400).json({ error: 'Missing mission.' });
  let decision;
  if (d.reopen === true) decision = { reopen: true };
  else if (b.type === 'fact' && s(String(d.value ?? ''))) decision = { value: s(String(d.value), 200) };
  else if (b.type === 'story' && id(d.main, 'st_')) decision = { main: d.main };
  else if (b.type === 'verify' && id(d.storyId, 'st_') && ['verified', 'disputed', 'unverified'].includes(d.status)) decision = { storyId: d.storyId, status: d.status };
  else if (b.type === 'parents' && id(d.personId, 'p_')) decision = { personId: d.personId, keep: ids(d.keep, 'p_') };
  else if (b.type === 'duplicate' && typeof d.same === 'boolean' && ids(d.personIds, 'p_').length === 2) {
    decision = { same: d.same, personIds: ids(d.personIds, 'p_'), names: (Array.isArray(d.names) ? d.names : []).slice(0, 2).map(n => s(n, 120)) };
  } else return res.status(400).json({ error: 'Incomplete decision.' });

  const r = {
    id: randomId('r_'), missionId, type: b.type, decision,
    note: s(b.note, 2000), resolvedBy: s(b.resolvedBy, 120) || 'Admin', resolvedAt: new Date().toISOString(),
  };
  try {
    await createFile(`${DATA_DIR}/resolutions/${r.resolvedAt.slice(0, 10)}-${missionId}-${r.id}.json`,
      Buffer.from(JSON.stringify(r, null, 2)).toString('base64'), `Family tree: decision on ${missionId}`);
    res.status(200).json({ id: r.id });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
