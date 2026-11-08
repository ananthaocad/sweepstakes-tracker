// Turns raw submissions (one per family member) into a single connected tree.
// Pure logic: no network or file access, so it can be unit-tested and run in a GitHub Action.
//
// Every rebuild starts from scratch and processes submissions oldest-first, so person ids
// are stable: an id depends only on the submission that first mentioned that person.

import { createHash } from 'node:crypto';

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'late', 'smt', 'shri', 'prof', 'sir', 'madam']);
const PLACEHOLDERS = new Set([
  '', 'unknown', 'not known', 'dont know', 'don t know', 'do not know', 'not sure', 'na', 'n a',
  'none', 'nil', 'no', 'idk', 'nobody', 'no one', 'not applicable',
]);

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

function hashId(seed) {
  return 'p_' + createHash('sha1').update(seed).digest('hex').slice(0, 10);
}

const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const year = v => {
  const n = parseInt(v, 10);
  return n > 1000 && n < 2200 ? n : null;
};

/** Keep only the newest submission per (device, person) so people can correct their entry. */
export function latestSubmissions(submissions) {
  const valid = submissions.filter(s => s && s.id && s.self && str(s.self.name) && !isPlaceholder(s.self.name));
  const latest = new Map();
  for (const s of valid) {
    const key = (s.clientId || s.id) + '|' + normalizeName(cleanName(s.self.name).name);
    const prev = latest.get(key);
    if (!prev || String(s.submittedAt) >= String(prev.submittedAt)) latest.set(key, s);
  }
  // Order by the *first* time each person submitted, so ids stay stable when someone updates.
  const firstSeen = new Map();
  for (const s of valid) {
    const key = (s.clientId || s.id) + '|' + normalizeName(cleanName(s.self.name).name);
    const t = String(s.submittedAt);
    if (!firstSeen.has(key) || t < firstSeen.get(key)) firstSeen.set(key, t);
  }
  return [...latest.entries()]
    .sort((a, b) => firstSeen.get(a[0]).localeCompare(firstSeen.get(b[0])) || a[1].id.localeCompare(b[1].id))
    .map(([, s]) => s);
}

class Builder {
  constructor() {
    this.people = new Map();
    this.byName = new Map(); // normalized alias -> Set(id)
    this.subToPerson = new Map(); // submission id (and all earlier ids from same device/person) -> person id
    this.photos = [];
  }

  newPerson(name, seed) {
    let id = hashId(seed);
    for (let i = 2; this.people.has(id); i++) id = hashId(seed + '#' + i);
    const p = {
      id, name, aliases: new Set(), gender: null, birthYear: null, deceased: false,
      location: '', birthPlace: '', origins: '', about: '', notes: [], photo: null,
      parents: new Set(), children: new Set(), spouses: new Set(), siblings: new Set(),
      selfSubmitted: false, clientIds: new Set(), submissionIds: [], mentionedBy: new Set(), invitedBy: null,
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
      const ok = (exact && multiToken) || isNear || ov > 0;
      if (!ok) continue;
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

  link(child, parent) {
    if (!child || !parent || child === parent) return;
    child.parents.add(parent.id);
    parent.children.add(child.id);
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

  addSubmission(s) {
    const self = s.self || {};
    const rels = []; // [role, {name, deceased, notes}]
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
    const inviter = s.invitedBy ? this.subToPerson.get(s.invitedBy) : null;

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
    if (['male', 'female'].includes(self.gender)) me.gender = self.gender;
    me.birthYear = year(self.birthYear) || me.birthYear;
    for (const f of ['location', 'birthPlace']) if (str(self[f], 200)) me[f] = str(self[f], 200);
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
      if (r.deceased === true) p.deceased = true;
      this.addNote(p, r.notes, me);
      if (/^(father|fatherFather|motherFather)$/.test(role) && !p.gender) p.gender = 'male';
      if (/^(mother|fatherMother|motherMother)$/.test(role) && !p.gender) p.gender = 'female';
    }

    // 3. Wire up relationships
    const { father, mother, spouse } = got;
    this.link(me, father);
    this.link(me, mother);
    this.marry(father, mother);
    this.link(father, got.fatherFather);
    this.link(father, got.fatherMother);
    this.marry(got.fatherFather, got.fatherMother);
    this.link(mother, got.motherFather);
    this.link(mother, got.motherMother);
    this.marry(got.motherFather, got.motherMother);
    this.marry(me, spouse);
    for (const [role, p] of Object.entries(got)) {
      if (role.startsWith('sibling')) {
        this.sibling(me, p);
        this.link(p, father);
        this.link(p, mother);
      } else if (role.startsWith('child')) {
        this.link(p, me);
        this.link(p, spouse);
      }
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
        id: 'ph_' + createHash('sha1').update(ph.path).digest('hex').slice(0, 10),
        path: ph.path, caption: str(ph.caption, 500), uploadedBy: me.id, submittedAt: s.submittedAt || null, tags,
      });
    }
  }

  finalize() {
    const P = this.people;

    // Siblings share parents: if any sibling's parents are known, fill them in for siblings without parents.
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const id of P.keys()) parent.set(id, id);
    for (const p of P.values()) for (const s of p.siblings) parent.set(find(p.id), find(s));
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
        if (known && m.parents.size === 0) for (const pid of known.parents) this.link(m, P.get(pid));
      }
    }
    // Anyone sharing a parent is a sibling; two parents of the same child are a couple.
    for (const p of P.values()) {
      const kids = [...p.children];
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) this.sibling(P.get(kids[i]), P.get(kids[j]));
      if (p.parents.size === 2) { const [a, b] = [...p.parents]; this.marry(P.get(a), P.get(b)); }
    }

    // Use a tagged photo as profile picture if none was given.
    for (const ph of this.photos) {
      if (ph.tags.length === 1 && ph.tags[0].personId) {
        const p = P.get(ph.tags[0].personId);
        if (p && !p.photo) p.photo = ph.path;
      }
    }

    const sorted = s => [...s].sort();
    const people = [...P.values()].map(p => ({
      id: p.id, name: p.name, gender: p.gender, birthYear: p.birthYear, deceased: p.deceased,
      location: p.location, birthPlace: p.birthPlace, origins: p.origins, about: p.about, notes: p.notes,
      photo: p.photo, parents: sorted(p.parents), children: sorted(p.children), spouses: sorted(p.spouses),
      siblings: sorted(p.siblings), selfSubmitted: p.selfSubmitted, invitedBy: p.invitedBy,
      mentionedBy: sorted(p.mentionedBy), aliases: sorted(p.aliases),
    }));
    return {
      people,
      photos: this.photos,
      submissionToPerson: Object.fromEntries(this.subToPerson),
      stats: {
        people: people.length,
        contributors: people.filter(p => p.selfSubmitted).length,
        photos: this.photos.length,
      },
    };
  }
}

export function buildTree(submissions) {
  const b = new Builder();
  const subs = latestSubmissions(submissions);
  // Older submission ids from the same device/person should still resolve (invite links use them).
  const keyOf = s => (s.clientId || s.id) + '|' + normalizeName(cleanName(s.self.name).name);
  const latestByKey = new Map(subs.map(s => [keyOf(s), s.id]));
  for (const s of subs) b.addSubmission(s);
  for (const s of submissions) {
    if (!s || !s.id || !s.self || !str(s.self.name) || b.subToPerson.has(s.id)) continue;
    const latestId = latestByKey.get(keyOf(s));
    if (latestId && b.subToPerson.has(latestId)) {
      const personId = b.subToPerson.get(latestId);
      b.subToPerson.set(s.id, personId);
      b.addPhotos(s, b.people.get(personId));
    }
  }
  return b.finalize();
}
