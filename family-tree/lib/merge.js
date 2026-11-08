// Turns raw data from the repo into one connected family tree:
//   submissions   – one per person who joined (their details, relatives, stories, photos)
//   contributions – later additions from anyone: a story, a fact correction, evidence for a mission
//   resolutions   – admin decisions that pick the "main" answer for an investigation mission
//
// Nothing is ever overwritten: every fact is kept as a *claim* (who said it, how they know).
// When claims disagree, an investigation *mission* is opened. The tree shows a provisional best
// answer until an admin resolves the mission; all other versions stay visible.
//
// Pure logic: no network or file access. Every rebuild starts from scratch and processes data
// oldest-first, so ids stay stable.

import { createHash } from 'node:crypto';

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'late', 'smt', 'shri', 'prof', 'sir', 'madam']);
const PLACEHOLDERS = new Set([
  '', 'unknown', 'not known', 'dont know', 'don t know', 'do not know', 'not sure', 'na', 'n a',
  'none', 'nil', 'no', 'idk', 'nobody', 'no one', 'not applicable',
]);
export const FACT_FIELDS = ['birthYear', 'birthPlace', 'deathYear', 'gender'];
export const SOURCES = ['witnessed', 'told', 'document'];
const SOURCE_WEIGHT = { document: 3, witnessed: 2, told: 1 };
const REL_SETS = ['parents', 'children', 'spouses', 'siblings'];
const INVERSE = { parents: 'children', children: 'parents', spouses: 'spouses', siblings: 'siblings' };

// ---------- name & value helpers ----------
export function normalizeName(name) {
  if (!name) return '';
  let s = String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const tokens = s.split(' ').filter(Boolean);
  while (tokens.length > 1 && HONORIFICS.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}

export function isPlaceholder(name) {
  return PLACEHOLDERS.has(normalizeName(name));
}

/** "Late Ramesh  Rao" -> { name: "Ramesh Rao", deceased: true } */
export function cleanName(raw) {
  let name = String(raw || '').replace(/\s+/g, ' ').trim();
  let deceased = false;
  const m = name.match(/^\(?late\)?\.?\s+/i);
  if (m) { deceased = true; name = name.slice(m[0].length); }
  return { name: name.slice(0, 120), deceased };
}

/** "Ravi" ~ "Ravi Kumar Rao": same first name and every token of the shorter is in the longer. */
export function fuzzyNameMatch(a, b) {
  if (!a || !b || a === b) return a === b && !!a;
  const ta = a.split(' '), tb = b.split(' ');
  if (ta[0] !== tb[0]) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every(t => long.includes(t));
}

/** Rough sound-alike key for common transliteration differences: Seetha ~ Sita, Lakshmi ~ Laxmi. */
export function phonetic(name) {
  return normalizeName(name)
    .replace(/ks/g, 'x').replace(/(ee|ii|y(?=[^aeiou]|$))/g, 'i').replace(/(oo|uu)/g, 'u').replace(/aa/g, 'a')
    .replace(/([bcdgjkpt])h/g, '$1').replace(/w/g, 'v').replace(/z/g, 'j').replace(/(.)\1+/g, '$1');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

export function namesSimilar(a, b) {
  if (fuzzyNameMatch(a, b)) return true;
  const pa = phonetic(a), pb = phonetic(b);
  if (pa === pb) return true;
  return Math.min(pa.length, pb.length) >= 5 && pa[0] === pb[0] && levenshtein(pa, pb) <= 1;
}

const sha = (s, n = 10) => createHash('sha1').update(String(s)).digest('hex').slice(0, n);
export const missionId = (...parts) => 'm_' + sha(parts.join('|'));
const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const year = v => {
  const n = parseInt(v, 10);
  return n > 1000 && n < 2200 ? n : null;
};

function canonical(field, raw) {
  if (field === 'birthYear' || field === 'deathYear') { const y = year(raw); return y ? String(y) : null; }
  if (field === 'gender') return ['male', 'female'].includes(raw) ? raw : null;
  return normalizeName(raw) || null;
}

/** Two values for the same fact that don't really disagree ("Mysore" vs "Mysore, Karnataka"). */
export function compatible(field, a, b) {
  const ca = canonical(field, a), cb = canonical(field, b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (field !== 'birthPlace') return false;
  const ta = ca.split(' '), tb = cb.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.every(t => long.includes(t))) return true;
  const first = v => normalizeName(String(v).split(',')[0]);
  return String(a).includes(',') && String(b).includes(',') && first(a) === first(b);
}

/** Keep only the newest submission per (device, person) so people can correct their entry. */
const subKey = s => (s.clientId || s.id) + '|' + normalizeName(cleanName(s.self.name).name);
export function latestSubmissions(submissions) {
  const valid = submissions.filter(s => s && s.id && s.self && str(s.self.name) && !isPlaceholder(s.self.name));
  const latest = new Map();
  const firstSeen = new Map();
  for (const s of valid) {
    const key = subKey(s);
    const prev = latest.get(key);
    if (!prev || String(s.submittedAt) >= String(prev.submittedAt)) latest.set(key, s);
    const t = String(s.submittedAt);
    if (!firstSeen.has(key) || t < firstSeen.get(key)) firstSeen.set(key, t);
  }
  // Order by the *first* time each person submitted, so ids stay stable when someone updates.
  return [...latest.entries()]
    .sort((a, b) => firstSeen.get(a[0]).localeCompare(firstSeen.get(b[0])) || a[1].id.localeCompare(b[1].id))
    .map(([, s]) => s);
}

/** Newest decision per mission wins; a `reopen` decision cancels the earlier one. */
function latestResolutions(resolutions) {
  const out = new Map();
  for (const r of [...resolutions].filter(r => r && r.missionId).sort((a, b) => String(a.resolvedAt).localeCompare(String(b.resolvedAt)))) {
    if (r.decision && r.decision.reopen) out.delete(r.missionId);
    else out.set(r.missionId, r);
  }
  return out;
}

class Builder {
  constructor(resolutions) {
    this.people = new Map();
    this.byName = new Map(); // normalized alias -> Set(id)
    this.subToPerson = new Map();
    this.photos = [];
    this.redirects = new Map(); // merged-away id -> surviving id
    this.edgeSources = new Map(); // "child|parent" -> Set(claimant person id)
    this.evidence = new Map(); // missionId -> [evidence]
    this.resolutions = latestResolutions(resolutions);
    this.counter = 0;
  }

  R(id) {
    let seen = 0;
    while (id && this.redirects.has(id) && seen++ < 50) id = this.redirects.get(id);
    return id;
  }
  get(id) { return this.people.get(this.R(id)); }

  newPerson(name, seed) {
    let id = 'p_' + sha(seed);
    for (let i = 2; this.people.has(id) || this.redirects.has(id); i++) id = 'p_' + sha(seed + '#' + i);
    const p = {
      id, name, order: this.counter++, aliases: new Set(), deceased: false,
      location: '', origins: '', about: '', notes: [], photo: null, claims: [], stories: [],
      parents: new Set(), children: new Set(), spouses: new Set(), siblings: new Set(), altParents: new Set(),
      selfSubmitted: false, clientIds: new Set(), submissionIds: [], mentionedBy: new Set(), invitedBy: null, mergedFrom: [],
    };
    this.people.set(id, p);
    this.addAlias(p, name);
    return p;
  }

  addAlias(p, name) {
    const n = normalizeName(name);
    if (!n) return;
    p.aliases.add(n);
    if (!this.byName.has(n)) this.byName.set(n, new Set());
    this.byName.get(n).add(p.id);
  }

  relatives(p) {
    return [...p.parents, ...p.children, ...p.spouses, ...p.siblings];
  }

  neighborhood(anchorIds, hops = 2) {
    const seen = new Set(anchorIds);
    let frontier = [...anchorIds];
    for (let h = 0; h < hops; h++) {
      const next = [];
      for (const id of frontier) {
        const p = this.people.get(id);
        if (!p) continue;
        for (const r of this.relatives(p)) if (!seen.has(r)) { seen.add(r); next.push(r); }
      }
      frontier = next;
    }
    return seen;
  }

  /** How many names from this submission already appear among the candidate's relatives. */
  overlap(p, relatedNames) {
    let score = 0;
    const relAliases = this.relatives(p).flatMap(id => [...this.people.get(id).aliases]);
    for (const n of relatedNames) if (relAliases.some(a => a === n || fuzzyNameMatch(a, n))) score++;
    return score;
  }

  /**
   * Find an existing person matching `name`, or null.
   * Full names ("Ravi Kumar") match anywhere; first-name-only or partial matches must be
   * close in the tree to the submitter, or share relatives' names, to avoid merging strangers.
   */
  find(name, { anchors = [], relatedNames = [], isSelf = false, clientId = null, exclude = null }) {
    const n = normalizeName(name);
    if (!n) return null;
    const near = this.neighborhood(anchors.filter(Boolean), 2);
    const multiToken = n.includes(' ');
    const scored = [];
    for (const p of this.people.values()) {
      const exact = p.aliases.has(n);
      const fuzzy = !exact && [...p.aliases].some(a => fuzzyNameMatch(a, n));
      if (!exact && !fuzzy) continue;
      if (exclude && exclude.has(p.id)) continue;
      const ov = this.overlap(p, relatedNames);
      const isNear = near.has(p.id);
      if (!((exact && multiToken) || isNear || ov > 0)) continue;
      // Someone else already registered with this name and nothing links them: likely a namesake.
      if (isSelf && p.selfSubmitted && !p.clientIds.has(clientId) && ov === 0 && !isNear) continue;
      scored.push({ p, score: ov * 3 + (isNear ? 2 : 0) + (exact ? 1 : 0) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.length ? scored[0].p : null;
  }

  resolve(rawName, opts) {
    const { name, deceased } = cleanName(rawName);
    if (!name || isPlaceholder(name)) return null;
    let p = this.find(name, opts);
    if (!p) p = this.newPerson(name, opts.seed);
    else if (normalizeName(name).split(' ').length > normalizeName(p.name).split(' ').length && !p.selfSubmitted) {
      p.name = name; // a fuller version of the name
    }
    this.addAlias(p, name);
    if (deceased) p.deceased = true;
    return p;
  }

  link(child, parent, by) {
    if (!child || !parent || child === parent) return;
    child.parents.add(parent.id);
    parent.children.add(child.id);
    if (by) {
      const k = child.id + '|' + parent.id;
      if (!this.edgeSources.has(k)) this.edgeSources.set(k, new Set());
      this.edgeSources.get(k).add(by.id);
    }
  }
  unlink(child, parent) {
    child.parents.delete(parent.id);
    parent.children.delete(child.id);
  }
  marry(a, b) {
    if (!a || !b || a === b) return;
    a.spouses.add(b.id);
    b.spouses.add(a.id);
  }
  sibling(a, b) {
    if (!a || !b || a === b) return;
    a.siblings.add(b.id);
    b.siblings.add(a.id);
  }

  addNote(p, text, by) {
    const t = str(text, 1000);
    if (p && t && !p.notes.some(n => n.text === t)) p.notes.push({ text: t, by: by ? by.id : null });
  }

  addClaim(p, field, raw, meta) {
    if (!p || !FACT_FIELDS.includes(field)) return;
    const value = field.endsWith('Year') ? year(raw) : str(String(raw ?? ''), 200);
    if (!value || !canonical(field, value)) return;
    // The same person repeating themselves counts once (keep their newest).
    p.claims = p.claims.filter(c => !(c.field === field && c.by && c.by === meta.by && c.ref === meta.ref));
    p.claims.push({
      field, value, by: meta.by || null, byName: meta.byName || null, self: !!meta.self,
      source: SOURCES.includes(meta.source) ? meta.source : (meta.self ? 'witnessed' : meta.source === 'role' ? 'role' : null),
      sourceDetail: str(meta.sourceDetail, 300), at: meta.at || null, ref: meta.ref || null,
    });
  }

  addStory(p, st, meta) {
    const text = str(st && st.text, 5000);
    if (!p || !text) return;
    const id = meta.id || 'st_' + sha(meta.seed + '|' + normalizeName(text).slice(0, 200));
    if (p.stories.some(s => s.id === id)) return;
    p.stories.push({
      id, title: str(st.title, 120), text, when: str(st.when, 80), where: str(st.where, 120),
      source: SOURCES.includes(st.source) ? st.source : null, sourceDetail: str(st.sourceDetail, 300),
      by: meta.by || null, byName: meta.byName || null, at: meta.at || null, replyTo: meta.replyTo || null,
    });
  }

  addSubmission(s) {
    const self = s.self || {};
    const rels = []; // [role, {name, deceased, notes, birthYear, birthPlace, deathYear}]
    const one = (role, r) => { if (r && str(r.name) && !isPlaceholder(r.name)) rels.push([role, r]); };
    one('father', s.father);
    one('mother', s.mother);
    one('fatherFather', s.fatherParents && s.fatherParents.father);
    one('fatherMother', s.fatherParents && s.fatherParents.mother);
    one('motherFather', s.motherParents && s.motherParents.father);
    one('motherMother', s.motherParents && s.motherParents.mother);
    one('spouse', s.spouse);
    (Array.isArray(s.siblings) ? s.siblings : []).slice(0, 30).forEach((r, i) => one('sibling' + i, typeof r === 'string' ? { name: r } : r));
    (Array.isArray(s.children) ? s.children : []).slice(0, 30).forEach((r, i) => one('child' + i, typeof r === 'string' ? { name: r } : r));

    const allNames = rels.map(([, r]) => normalizeName(cleanName(r.name).name));
    const inviter = s.invitedBy ? this.R(this.subToPerson.get(s.invitedBy)) : null;
    const at = s.submittedAt || null;
    const seedBase = s.clientId || s.id;

    // 1. Who is submitting?
    const selfName = cleanName(self.name).name;
    let me = this.find(selfName, { anchors: [inviter], relatedNames: allNames, isSelf: true, clientId: s.clientId });
    if (!me) me = this.newPerson(selfName, s.id + ':self');
    me.name = selfName;
    this.addAlias(me, selfName);
    me.selfSubmitted = true;
    if (s.clientId) me.clientIds.add(s.clientId);
    me.submissionIds.push(s.id);
    if (inviter && inviter !== me.id && !me.invitedBy) me.invitedBy = inviter;
    const selfMeta = { by: me.id, self: true, at, ref: 'self' };
    this.addClaim(me, 'gender', self.gender, selfMeta);
    this.addClaim(me, 'birthYear', self.birthYear, selfMeta);
    this.addClaim(me, 'birthPlace', self.birthPlace, selfMeta);
    if (str(self.location, 200)) me.location = str(self.location, 200);
    if (str(self.about)) me.about = str(self.about);
    if (str(s.origins)) me.origins = str(s.origins);
    if (s.profilePhoto && typeof s.profilePhoto === 'string') me.photo = s.profilePhoto;
    this.subToPerson.set(s.id, me.id);

    // 2. Their relatives
    const got = {};
    const taken = new Set([me.id]);
    for (const [role, r] of rels) {
      const own = normalizeName(cleanName(r.name).name);
      const p = this.resolve(r.name, {
        anchors: [me.id, inviter],
        relatedNames: [normalizeName(selfName), ...allNames.filter(n => n !== own)],
        seed: s.id + ':' + role,
        exclude: taken,
      });
      if (!p) continue;
      taken.add(p.id);
      got[role] = p;
      p.mentionedBy.add(me.id);
      const meta = { by: me.id, at, ref: role, source: r.source };
      if (r.deceased === true || year(r.deathYear)) p.deceased = true;
      this.addNote(p, r.notes, me);
      this.addClaim(p, 'birthYear', r.birthYear, meta);
      this.addClaim(p, 'birthPlace', r.birthPlace, meta);
      this.addClaim(p, 'deathYear', r.deathYear, meta);
      if (/^(father|fatherFather|motherFather)$/.test(role)) this.addClaim(p, 'gender', 'male', { ...meta, source: 'role' });
      if (/^(mother|fatherMother|motherMother)$/.test(role)) this.addClaim(p, 'gender', 'female', { ...meta, source: 'role' });
    }

    // 3. Wire up relationships
    const { father, mother, spouse } = got;
    this.link(me, father, me);
    this.link(me, mother, me);
    this.marry(father, mother);
    this.link(father, got.fatherFather, me);
    this.link(father, got.fatherMother, me);
    this.marry(got.fatherFather, got.fatherMother);
    this.link(mother, got.motherFather, me);
    this.link(mother, got.motherMother, me);
    this.marry(got.motherFather, got.motherMother);
    this.marry(me, spouse);
    for (const [role, p] of Object.entries(got)) {
      if (role.startsWith('sibling')) {
        this.sibling(me, p);
        this.link(p, father, me);
        this.link(p, mother, me);
      } else if (role.startsWith('child')) {
        this.link(p, me, me);
        this.link(p, spouse, me);
      }
    }

    // 4. Stories and anecdotes
    for (const st of (Array.isArray(s.stories) ? s.stories : []).slice(0, 50)) {
      const about = st && st.about;
      const target = about === 'self' ? me : got[about];
      this.addStory(target, st, { seed: seedBase + '|' + about, by: me.id, at });
    }

    this.addPhotos(s, me, got);
  }

  /** Photos from every submission are kept, even when a newer submission replaces the details. */
  addPhotos(s, me, got = {}) {
    const selfName = cleanName(s.self && s.self.name).name;
    const tagCtx = { anchors: [me.id], relatedNames: [] };
    const pos = v => (typeof v === 'number' && v >= 0 && v <= 1 ? Math.round(v * 1000) / 1000 : null);
    for (const ph of (Array.isArray(s.photos) ? s.photos : []).slice(0, 30)) {
      if (!ph || typeof ph.path !== 'string' || this.photos.some(x => x.path === ph.path)) continue;
      const tags = [];
      for (const t of (Array.isArray(ph.tags) ? ph.tags : []).slice(0, 40)) {
        const tagName = cleanName(t && t.name).name;
        if (!tagName) continue;
        const n = normalizeName(tagName);
        let person = null;
        if (n === normalizeName(selfName) || t.self === true) person = me;
        else person = Object.values(got).find(p => p.aliases.has(n)) || this.find(tagName, tagCtx);
        if (tags.some(x => x.personId && person && x.personId === person.id)) continue;
        tags.push({ personId: person ? person.id : null, name: person ? null : tagName, x: pos(t.x), y: pos(t.y) });
      }
      this.photos.push({
        id: 'ph_' + sha(ph.path), path: ph.path, caption: str(ph.caption, 500),
        uploadedBy: me.id, submittedAt: s.submittedAt || null, tags,
      });
    }
  }

  /** Later additions from anyone: a story, a fact, or evidence for a mission. */
  addContribution(c) {
    if (!c || !c.id || !c.kind) return;
    const by = c.by ? this.R(this.subToPerson.get(c.by)) || null : null;
    const byName = by ? null : str(c.byName, 120) || null;
    const meta = { by, byName, at: c.submittedAt || null };
    if (c.kind === 'evidence') {
      if (typeof c.missionId !== 'string') return;
      if (!this.evidence.has(c.missionId)) this.evidence.set(c.missionId, []);
      this.evidence.get(c.missionId).push({
        id: c.id, ...meta, supports: str(c.supports, 200) || null, text: str(c.text, 3000),
        photo: typeof c.photo === 'string' ? c.photo : null,
        source: SOURCES.includes(c.source) ? c.source : null, sourceDetail: str(c.sourceDetail, 300),
      });
      return;
    }
    const p = this.get(c.personId);
    if (!p) return;
    if (c.kind === 'story') this.addStory(p, c, { ...meta, id: 'st_' + sha(c.id), replyTo: str(c.replyTo, 40) || null });
    if (c.kind === 'fact') this.addClaim(p, c.field, c.value, { ...meta, ref: c.id, source: c.source, sourceDetail: c.sourceDetail });
  }

  /** Admin said two entries are the same person: fold `drop` into `keep`, remembering both. */
  merge(keep, drop) {
    if (!keep || !drop || keep === drop) return;
    if (drop.order < keep.order || (drop.selfSubmitted && !keep.selfSubmitted)) [keep, drop] = [drop, keep];
    for (const a of drop.aliases) this.addAlias(keep, a);
    for (const set of REL_SETS) {
      for (const id of drop[set]) {
        const o = this.people.get(id);
        if (!o) continue;
        o[INVERSE[set]].delete(drop.id);
        if (o !== keep) { o[INVERSE[set]].add(keep.id); keep[set].add(id); }
      }
      keep[set].delete(drop.id);
      keep[set].delete(keep.id);
    }
    for (const [k, v] of [...this.edgeSources]) {
      const [c, p] = k.split('|');
      if (c !== drop.id && p !== drop.id) continue;
      this.edgeSources.delete(k);
      const nk = (c === drop.id ? keep.id : c) + '|' + (p === drop.id ? keep.id : p);
      this.edgeSources.set(nk, new Set([...(this.edgeSources.get(nk) || []), ...v]));
    }
    keep.claims.push(...drop.claims);
    keep.stories.push(...drop.stories);
    keep.notes.push(...drop.notes.filter(n => !keep.notes.some(k => k.text === n.text)));
    if (drop.selfSubmitted && !keep.selfSubmitted) keep.name = drop.name;
    else if (!keep.selfSubmitted && drop.name.length > keep.name.length) keep.name = drop.name;
    keep.selfSubmitted ||= drop.selfSubmitted;
    keep.deceased ||= drop.deceased;
    for (const f of ['photo', 'location', 'origins', 'about', 'invitedBy']) keep[f] ||= drop[f];
    drop.clientIds.forEach(x => keep.clientIds.add(x));
    drop.mentionedBy.forEach(x => keep.mentionedBy.add(x));
    keep.submissionIds.push(...drop.submissionIds);
    keep.mergedFrom.push(drop.id, ...drop.mergedFrom);
    this.people.delete(drop.id);
    this.redirects.set(drop.id, keep.id);
  }

  applyMerges() {
    for (const r of this.resolutions.values()) {
      if (r.type === 'duplicate' && r.decision && r.decision.same === true && Array.isArray(r.decision.personIds)) {
        const [a, b] = r.decision.personIds.map(id => this.get(id));
        this.merge(a, b);
      }
    }
  }

  /** Admin chose which parents are right: other parent links are kept only as "also reported". */
  applyParentDecisions() {
    for (const r of this.resolutions.values()) {
      if (r.type !== 'parents' || !r.decision || !Array.isArray(r.decision.keep)) continue;
      const child = this.get(r.decision.personId);
      if (!child) continue;
      const keep = new Set(r.decision.keep.map(id => this.R(id)));
      for (const pid of [...child.parents]) {
        if (keep.has(pid)) continue;
        this.unlink(child, this.people.get(pid));
        child.altParents.add(pid);
      }
    }
  }

  infer() {
    const P = this.people;
    // Siblings share parents: fill them in for siblings whose parents nobody mentioned.
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const id of P.keys()) parent.set(id, id);
    for (const p of P.values()) for (const s of p.siblings) if (P.has(s)) parent.set(find(p.id), find(s));
    const groups = new Map();
    for (const id of P.keys()) {
      const r = find(id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(P.get(id));
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const known = members.find(m => m.parents.size > 0);
      for (const m of members) {
        for (const o of members) if (o !== m) this.sibling(m, o);
        if (known && m.parents.size === 0) for (const pid of known.parents) if (!m.altParents.has(pid)) this.link(m, P.get(pid));
      }
    }
    // Anyone sharing a parent is a sibling; two parents of the same child are a couple.
    for (const p of P.values()) {
      const kids = [...p.children];
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) this.sibling(P.get(kids[i]), P.get(kids[j]));
      if (p.parents.size === 2) { const [a, b] = [...p.parents]; this.marry(P.get(a), P.get(b)); }
    }
    // Use a photo with exactly one tagged person as that person's picture if they have none.
    for (const ph of this.photos) {
      if (ph.tags.length === 1 && ph.tags[0].personId) {
        const p = this.get(ph.tags[0].personId);
        if (p && !p.photo) p.photo = ph.path;
      }
    }
  }

  /** How close `other` is to `p` — closer relatives are more likely to know the facts. */
  relation(p, otherId) {
    if (!otherId) return ['someone', 1];
    if (otherId === p.id) return ['themselves', 10];
    if (p.children.has(otherId)) return ['child', 5];
    if (p.spouses.has(otherId)) return ['spouse', 5];
    if (p.siblings.has(otherId)) return ['sibling', 4];
    if (p.parents.has(otherId)) return ['parent', 4];
    if ([...p.children].some(c => this.people.get(c) && this.people.get(c).children.has(otherId))) return ['grandchild', 3];
    if ([...p.parents].some(c => this.people.get(c) && this.people.get(c).parents.has(otherId))) return ['grandparent', 3];
    return ['relative', 1];
  }

  helpers(subjects, exclude = new Set()) {
    const near = this.neighborhood(subjects.map(s => s.id), 2);
    return [...near].map(id => this.people.get(id))
      .filter(h => h && h.selfSubmitted && !exclude.has(h.id))
      .map(h => {
        const best = subjects.map(s => this.relation(s, h.id)).sort((a, b) => b[1] - a[1])[0];
        return { personId: h.id, relation: best[0], score: best[1] };
      })
      .sort((a, b) => b.score - a.score).slice(0, 6)
      .map(({ personId, relation }) => ({ personId, relation }));
  }

  claimView(p, c) {
    return {
      value: c.value, by: c.by ? this.R(c.by) : null, byName: c.byName, self: c.self,
      relation: c.by ? this.relation(p, this.R(c.by))[0] : 'someone', source: c.source, sourceDetail: c.sourceDetail, at: c.at,
    };
  }

  /** Group claims, pick a main value (admin decision > provisional ranking), open missions on conflict. */
  buildFactsAndMissions() {
    const missions = [];
    for (const p of this.people.values()) {
      p.facts = {};
      for (const field of FACT_FIELDS) {
        const claims = p.claims.filter(c => c.field === field);
        const mid = missionId('fact', p.id, field);
        const resolution = this.resolutions.get(mid);
        const evidence = this.evidence.get(mid) || [];
        if (!claims.length && !resolution) continue;
        const groups = [];
        for (const c of claims) {
          const g = groups.find(g => g.claims.some(o => compatible(field, o.value, c.value)));
          if (g) g.claims.push(c); else groups.push({ claims: [c] });
        }
        for (const g of groups) {
          g.value = g.claims.map(c => c.value).sort((a, b) => String(b).length - String(a).length)[0];
          g.key = canonical(field, g.value);
          const support = evidence.filter(e => e.supports && compatible(field, e.supports, g.value));
          const nonRole = g.claims.filter(c => c.source !== 'role');
          g.score = (g.claims.some(c => c.self) ? 1000 : 0) + (nonRole.length + support.length) * 10 +
            Math.max(0, ...g.claims.map(c => (c.by ? this.relation(p, this.R(c.by))[1] : 1) + (SOURCE_WEIGHT[c.source] || 0))) +
            (g.claims.some(c => c.source === 'role') ? 2 : 0);
          g.firstAt = g.claims.map(c => String(c.at || '')).sort()[0];
        }
        groups.sort((a, b) => b.score - a.score || a.firstAt.localeCompare(b.firstAt));

        let main = groups[0] || null;
        let status = groups.length > 1 ? 'disputed' : 'agreed';
        const decided = resolution && resolution.decision && resolution.decision.value != null ? String(resolution.decision.value) : null;
        if (decided) {
          main = groups.find(g => compatible(field, g.value, decided));
          if (!main) { main = { value: field.endsWith('Year') ? year(decided) : decided, key: canonical(field, decided), claims: [], admin: true }; groups.push(main); }
          status = groups.length > 1 ? 'resolved' : 'verified';
        }
        if (!main) continue;
        p.facts[field] = { value: main.value, status, missionId: mid, accounts: claims.length };
        if (groups.length > 1) {
          missions.push({
            id: mid, type: 'fact', field, personIds: [p.id],
            status: resolution ? 'resolved' : 'open',
            main: main.key,
            options: groups.map(g => ({ key: g.key, value: g.value, admin: !!g.admin, claims: g.claims.map(c => this.claimView(p, c)) })),
            evidence, resolution: resolution || null,
            helpers: this.helpers([p], new Set(claims.map(c => this.R(c.by)))),
          });
        }
      }
      // Gender from a role ("father") is a fact too; years and places go to the top level for convenience.
      for (const f of FACT_FIELDS) p[f] = p.facts[f] ? p.facts[f].value : null;
      if (p.deathYear) p.deceased = true;
    }
    return missions;
  }

  parentMissions() {
    const missions = [];
    for (const child of this.people.values()) {
      const mid = missionId('parents', child.id);
      const resolution = this.resolutions.get(mid);
      const parents = [...child.parents].map(id => this.people.get(id));
      const byGender = g => parents.filter(p => p.gender === g).length;
      const conflict = parents.length > 2 || byGender('male') > 1 || byGender('female') > 1;
      if (!conflict && !resolution) continue;
      const all = [...parents, ...[...child.altParents].map(id => this.get(id)).filter(Boolean)];
      missions.push({
        id: mid, type: 'parents', personIds: [child.id],
        status: resolution && !conflict ? 'resolved' : 'open',
        main: [...child.parents].sort().join(','),
        options: all.map(par => ({
          key: par.id, value: par.name, personId: par.id, kept: child.parents.has(par.id),
          claims: [...(this.edgeSources.get(child.id + '|' + par.id) || [])].map(by => ({ by: this.R(by), relation: this.relation(child, this.R(by))[0] })),
        })),
        evidence: this.evidence.get(mid) || [], resolution: resolution || null,
        helpers: this.helpers([child]),
      });
    }
    return missions;
  }

  /** Two entries that might be the same person: similar names and a shared parent, child or spouse. */
  duplicateMissions() {
    const missions = [];
    const list = [...this.people.values()];
    const share = (a, b) => ['parents', 'children', 'spouses'].some(s => [...a[s]].some(id => b[s].has(id)));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.gender && b.gender && a.gender !== b.gender) continue;
        if (a.spouses.has(b.id) || a.parents.has(b.id) || a.children.has(b.id)) continue;
        if (a.selfSubmitted && b.selfSubmitted) continue;
        if (!share(a, b)) continue;
        if (![...a.aliases].some(x => [...b.aliases].some(y => namesSimilar(x, y)))) continue;
        const ids = [a.id, b.id].sort();
        const mid = missionId('dup', ...ids);
        const resolution = this.resolutions.get(mid);
        missions.push({
          id: mid, type: 'duplicate', personIds: ids, status: resolution ? 'resolved' : 'open',
          main: resolution ? 'different' : null,
          options: [{ key: 'same', value: 'Same person' }, { key: 'different', value: 'Different people' }],
          evidence: this.evidence.get(mid) || [], resolution: resolution || null,
          helpers: this.helpers([a, b]),
        });
      }
    }
    // Merges that already happened stay listed as resolved missions.
    for (const [mid, r] of this.resolutions) {
      if (r.type !== 'duplicate' || !r.decision || r.decision.same !== true) continue;
      const survivor = this.get((r.decision.personIds || [])[0]);
      if (!survivor) continue;
      missions.push({
        id: mid, type: 'duplicate', personIds: [survivor.id], status: 'resolved', main: 'same',
        options: [{ key: 'same', value: 'Same person' }, { key: 'different', value: 'Different people' }],
        mergedNames: (r.decision.names || []).slice(0, 2), evidence: this.evidence.get(mid) || [], resolution: r, helpers: [],
      });
    }
    return missions;
  }

  /** Stories told differently by different people; plus the verified/disputed status of every story. */
  storyMissions() {
    const missions = [];
    for (const p of this.people.values()) {
      const byId = new Map(p.stories.map(s => [s.id, s]));
      const rootOf = s => { let r = s, n = 0; while (r.replyTo && byId.has(r.replyTo) && n++ < 20) r = byId.get(r.replyTo); return r; };
      const groups = new Map();
      for (const s of p.stories) {
        const root = rootOf(s);
        s.versionOf = root.id === s.id ? null : root.id;
        if (!groups.has(root.id)) groups.set(root.id, []);
        groups.get(root.id).push(s);
      }
      for (const [rootId, versions] of groups) {
        const mid = missionId('story', rootId);
        const resolution = this.resolutions.get(mid);
        const chosen = resolution && resolution.decision && versions.find(v => v.id === resolution.decision.main);
        const main = chosen || versions[0];
        for (const v of versions) {
          const vr = this.resolutions.get(missionId('verify', v.id));
          const verdict = vr && vr.decision && vr.decision.status;
          v.isMain = v === main;
          v.missionId = versions.length > 1 ? mid : null;
          v.verifyMissionId = missionId('verify', v.id);
          v.status = verdict === 'disputed' ? 'disputed'
            : verdict === 'verified' || (chosen && v.isMain) ? 'verified'
            : versions.length > 1 && !chosen ? 'disputed' : 'unverified';
          v.verification = vr || null;
        }
        if (versions.length > 1) {
          missions.push({
            id: mid, type: 'story', personIds: [p.id], status: chosen ? 'resolved' : 'open', main: main.id,
            title: main.title || null,
            options: versions.map(v => ({ key: v.id, value: v.title || v.text.slice(0, 80), storyId: v.id, claims: [{ by: v.by ? this.R(v.by) : null, byName: v.byName, relation: this.relation(p, this.R(v.by))[0], source: v.source, sourceDetail: v.sourceDetail, at: v.at }] })),
            evidence: this.evidence.get(mid) || [], resolution: resolution || null,
            helpers: this.helpers([p], new Set(versions.map(v => this.R(v.by)))),
          });
        }
      }
    }
    return missions;
  }

  finalize() {
    this.applyMerges();
    this.applyParentDecisions();
    this.infer();
    const factMissions = this.buildFactsAndMissions(); // sets gender, which the checks below use
    const missions = [
      ...this.duplicateMissions(),
      ...this.parentMissions(),
      ...factMissions,
      ...this.storyMissions(),
    ];
    const R = id => this.R(id);
    const ids = s => [...s].map(R).filter(id => this.people.has(id)).filter((v, i, a) => a.indexOf(v) === i).sort();
    const people = [...this.people.values()].map(p => ({
      id: p.id, name: p.name, gender: p.gender, birthYear: p.birthYear, birthPlace: p.birthPlace, deathYear: p.deathYear,
      deceased: p.deceased, location: p.location, origins: p.origins, about: p.about,
      notes: p.notes.map(n => ({ ...n, by: R(n.by) })),
      facts: p.facts,
      claims: p.claims.map(c => ({ field: c.field, ...this.claimView(p, c) })),
      stories: p.stories.map(s => ({ ...s, by: R(s.by) }))
        .sort((a, b) => (a.versionOf ? 1 : 0) - (b.versionOf ? 1 : 0) || String(a.at).localeCompare(String(b.at))),
      photo: p.photo, parents: ids(p.parents), children: ids(p.children), spouses: ids(p.spouses), siblings: ids(p.siblings),
      altParents: ids(p.altParents), selfSubmitted: p.selfSubmitted, invitedBy: R(p.invitedBy) || null,
      mentionedBy: ids(p.mentionedBy), aliases: [...p.aliases].sort(), mergedFrom: p.mergedFrom,
    }));
    const photos = this.photos.map(ph => ({ ...ph, uploadedBy: R(ph.uploadedBy), tags: ph.tags.map(t => ({ ...t, personId: R(t.personId) || null })) }));
    for (const m of missions) for (const e of m.evidence) e.by = R(e.by) || null;
    missions.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || a.id.localeCompare(b.id));
    return {
      people,
      photos,
      missions,
      submissionToPerson: Object.fromEntries([...this.subToPerson].map(([k, v]) => [k, R(v)])),
      redirects: Object.fromEntries([...this.redirects.keys()].map(k => [k, R(k)])),
      stats: {
        people: people.length,
        contributors: people.filter(p => p.selfSubmitted).length,
        photos: photos.length,
        stories: people.reduce((n, p) => n + p.stories.length, 0),
        openMissions: missions.filter(m => m.status === 'open').length,
      },
    };
  }
}

export function buildTree(submissions, contributions = [], resolutions = []) {
  const b = new Builder(resolutions);
  const subs = latestSubmissions(submissions);
  // Older submission ids from the same device/person should still resolve (invite links use them).
  const latestByKey = new Map(subs.map(s => [subKey(s), s.id]));
  for (const s of subs) b.addSubmission(s);
  for (const s of submissions) {
    if (!s || !s.id || !s.self || !str(s.self.name) || b.subToPerson.has(s.id)) continue;
    const latestId = latestByKey.get(subKey(s));
    if (latestId && b.subToPerson.has(latestId)) {
      const personId = b.subToPerson.get(latestId);
      b.subToPerson.set(s.id, personId);
      b.addPhotos(s, b.people.get(personId));
    }
  }
  const sorted = [...contributions].filter(Boolean).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  for (const c of sorted) b.addContribution(c);
  return b.finalize();
}
