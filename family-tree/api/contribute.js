// POST /api/contribute { contribution } -> stores data/contributions/<id>.json
// Lets anyone with the family link add to the tree after joining (or without joining):
//   { kind: 'story',    personId, title, text, when, where, source, sourceDetail, replyTo? }   a memory / anecdote, or another version of one
//   { kind: 'fact',     personId, field, value, source, sourceDetail }                          "I believe he was born in 1934"
//   { kind: 'evidence', missionId, supports, text, photo?, source, sourceDetail }               help settle an investigation
import { guard, createFile, DATA_DIR, randomId } from './_lib/github.js';
import { s, id, story, source, FACT_FIELDS } from './_lib/clean.js';

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;
  const b = (req.body && req.body.contribution) || {};
  const base = {
    id: randomId('c_'),
    submittedAt: new Date().toISOString(),
    clientId: s(b.clientId, 64) || null,
    by: id(b.by, 's_') || null, // the contributor's own submission id, if they joined
    byName: s(b.byName, 120) || null,
    kind: b.kind,
  };
  if (!base.by && !base.byName) return res.status(400).json({ error: 'Please tell us your name.' });

  let c;
  if (b.kind === 'story') {
    const st = story(b);
    if (!id(b.personId, 'p_') || !st) return res.status(400).json({ error: 'Please write the story.' });
    c = { ...base, personId: b.personId, ...st, replyTo: id(b.replyTo, 'st_') };
  } else if (b.kind === 'fact') {
    if (!id(b.personId, 'p_') || !FACT_FIELDS.includes(b.field) || !s(String(b.value ?? ''))) return res.status(400).json({ error: 'Please fill in the value.' });
    c = { ...base, personId: b.personId, field: b.field, value: s(String(b.value), 200), source: source(b.source), sourceDetail: s(b.sourceDetail, 300) };
  } else if (b.kind === 'evidence') {
    const photo = typeof b.photo === 'string' && b.photo.startsWith(`${DATA_DIR}/photos/`) && !b.photo.includes('..') ? b.photo : null;
    if (!id(b.missionId, 'm_') || (!s(b.text) && !photo && !s(b.supports))) return res.status(400).json({ error: 'Please add what you know.' });
    c = { ...base, missionId: b.missionId, supports: s(String(b.supports ?? ''), 200) || null, text: s(b.text, 3000), photo, source: source(b.source), sourceDetail: s(b.sourceDetail, 300) };
  } else {
    return res.status(400).json({ error: 'Unknown contribution type.' });
  }

  try {
    await createFile(`${DATA_DIR}/contributions/${c.submittedAt.slice(0, 10)}-${c.kind}-${c.id}.json`,
      Buffer.from(JSON.stringify(c, null, 2)).toString('base64'), `Family tree: new ${c.kind}`);
    res.status(200).json({ id: c.id });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
