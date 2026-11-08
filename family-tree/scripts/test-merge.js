// Quick self-check for the tree-merging logic: `npm test`
import assert from 'node:assert/strict';
import { buildTree, normalizeName, fuzzyNameMatch, namesSimilar, compatible, missionId } from '../lib/merge.js';

assert.equal(normalizeName('  Late Mr. Ramesh   RAO '), 'ramesh rao');
assert.equal(normalizeName('José Álvarez'), 'jose alvarez');
assert.equal(normalizeName('ராமன்'), 'ராமன்'.normalize('NFKD'));
assert.ok(fuzzyNameMatch('ravi', 'ravi kumar'));
assert.ok(!fuzzyNameMatch('ravi', 'kumar ravi'));

const subs = [
  {
    id: 's1', clientId: 'dev-a', submittedAt: '2026-01-01T00:00:00Z',
    self: { name: 'Anantha Rao', gender: 'male', birthYear: '1985', location: 'Toronto' },
    father: { name: 'Ramesh Rao' }, mother: { name: 'Lakshmi Rao' },
    fatherParents: { father: { name: 'Late Venkat Rao', notes: 'Teacher in Mysore' }, mother: { name: 'Sita' } },
    siblings: [{ name: 'Priya Rao' }], spouse: { name: 'Meena' }, children: [{ name: 'Arjun Rao' }],
    origins: 'Mysore, Karnataka',
    photos: [{ path: 'family-tree/data/photos/a.jpg', caption: 'Diwali', tags: [{ name: 'Ramesh Rao', x: 0.3, y: 0.4 }, { name: 'Uncle Bob' }] }],
  },
  // Priya, invited by Anantha, gives only first names for parents and adds her own child.
  {
    id: 's2', clientId: 'dev-b', submittedAt: '2026-01-02T00:00:00Z', invitedBy: 's1',
    self: { name: 'Priya Rao Shetty' }, father: { name: 'Ramesh' }, mother: { name: 'Lakshmi' },
    siblings: ['Anantha Rao'], children: ['Kavya'],
  },
  // Cousin: son of Ramesh's brother Suresh. Mentions grandfather by full name.
  {
    id: 's3', clientId: 'dev-c', submittedAt: '2026-01-03T00:00:00Z', invitedBy: 's2',
    self: { name: 'Kiran Rao' }, father: { name: 'Suresh Rao' }, mother: { name: 'Uma' },
    fatherParents: { father: { name: 'Venkat Rao' }, mother: { name: 'Sita Rao' } },
  },
  // An unrelated "Lakshmi" in a different family must not be merged with Anantha's mother.
  {
    id: 's4', clientId: 'dev-d', submittedAt: '2026-01-04T00:00:00Z',
    self: { name: 'Gopal Iyer' }, mother: { name: 'Lakshmi' }, father: { name: 'unknown' },
  },
  // Anantha updates their entry later from the same device.
  {
    id: 's5', clientId: 'dev-a', submittedAt: '2026-02-01T00:00:00Z',
    self: { name: 'Anantha Rao', location: 'Vancouver' },
    father: { name: 'Ramesh Rao' }, mother: { name: 'Lakshmi Rao' },
    fatherParents: { father: { name: 'Late Venkat Rao', notes: 'Teacher in Mysore' }, mother: { name: 'Sita' } },
    siblings: [{ name: 'Priya Rao' }], spouse: { name: 'Meena' }, children: [{ name: 'Arjun Rao' }],
  },
];

const tree = buildTree(subs);
const byName = n => tree.people.filter(p => p.aliases.includes(normalizeName(n)));
const one = n => { const r = byName(n); assert.equal(r.length, 1, `expected exactly one "${n}", got ${r.length}`); return r[0]; };
const names = ids => ids.map(id => tree.people.find(p => p.id === id).name).sort();

const anantha = one('Anantha Rao');
assert.equal(anantha.location, 'Vancouver', 'latest submission wins');
assert.equal(tree.submissionToPerson.s1, anantha.id, 'old submission id still resolves (invite links)');
const priya = one('Priya Rao Shetty');
assert.equal(one('Priya Rao').id, priya.id, 'Priya mentioned by Anantha = Priya who signed up');
assert.deepEqual(names(priya.parents), ['Lakshmi Rao', 'Ramesh Rao']);
assert.deepEqual(names(anantha.siblings), ['Priya Rao Shetty']);
const ramesh = one('Ramesh Rao');
assert.deepEqual(names(ramesh.parents), ['Sita Rao', 'Venkat Rao']);
const venkat = one('Venkat Rao');
assert.ok(venkat.deceased);
assert.equal(venkat.notes[0].text, 'Teacher in Mysore');
const suresh = one('Suresh Rao');
assert.deepEqual(names(suresh.parents), ['Sita Rao', 'Venkat Rao'], 'cousin branch joins at grandparents');
assert.ok(names(ramesh.siblings).includes('Suresh Rao'), 'brothers inferred from shared parents');
assert.deepEqual(names(one('Arjun Rao').parents), ['Anantha Rao', 'Meena']);
assert.equal(byName('Lakshmi').length, 2, 'unrelated Lakshmi is a separate person');
assert.ok(!tree.people.some(p => p.name === 'unknown'));
const photo = tree.photos[0];
assert.equal(photo.tags[0].personId, ramesh.id);
assert.equal(photo.tags[1].name, 'Uncle Bob');
assert.equal(ramesh.photo, null, 'group photo with 1 known tag + unknown is not used as profile');


// ---------- claims, stories, missions ----------
assert.ok(namesSimilar('sita', 'seetha'));
assert.ok(namesSimilar('lakshmi', 'laxmi'));
assert.ok(!namesSimilar('ravi', 'rani'));
assert.ok(compatible('birthPlace', 'Mysore', 'Mysore, Karnataka'));
assert.ok(!compatible('birthPlace', 'Mysore', 'Mangalore'));

const fam = [
  {
    id: 'f1', clientId: 'A', submittedAt: '2026-03-01T00:00:00Z',
    self: { name: 'Anil Nair', gender: 'male', birthYear: '1980' },
    father: { name: 'Mohan Nair', birthYear: '1950', birthPlace: 'Kochi' },
    mother: { name: 'Seetha Nair' },
    stories: [{ about: 'father', title: 'The bicycle', text: 'Dad cycled 20km to school every day.', source: 'told', sourceDetail: 'Grandma' }],
  },
  {
    id: 'f2', clientId: 'B', submittedAt: '2026-03-02T00:00:00Z', invitedBy: 'f1',
    self: { name: 'Bina Nair', birthYear: '1983' },
    father: { name: 'Mohan Nair', birthYear: '1952', birthPlace: 'Kochi, Kerala' },
    mother: { name: 'Sita Nair' },
    siblings: ['Anil Nair'],
  },
  // Mohan himself joins later and gives his own birth year.
  { id: 'f3', clientId: 'C', submittedAt: '2026-03-03T00:00:00Z', self: { name: 'Mohan Nair', birthYear: '1951' }, children: ['Anil Nair', 'Bina Nair'] },
];
let t = buildTree(fam);
const find = n => t.people.find(p => p.aliases.includes(normalizeName(n)));
let mohan = find('Mohan Nair');
assert.equal(mohan.facts.birthYear.status, 'disputed');
assert.equal(mohan.birthYear, 1951, 'self-reported value is the provisional main');
assert.equal(mohan.facts.birthPlace.status, 'agreed', 'Kochi and "Kochi, Kerala" agree');
assert.equal(mohan.birthPlace, 'Kochi, Kerala');
assert.equal(mohan.claims.filter(c => c.field === 'birthYear').length, 3, 'every account is kept');
const yearMission = t.missions.find(m => m.type === 'fact' && m.field === 'birthYear' && m.personIds[0] === mohan.id);
assert.equal(yearMission.status, 'open');
assert.equal(yearMission.options.length, 3);
assert.equal(mohan.stories[0].title, 'The bicycle');
assert.equal(mohan.stories[0].status, 'unverified');

// Sita / Seetha: two entries, both mothers of Anil & Bina -> "same person?" mission
const dup = t.missions.find(m => m.type === 'duplicate');
assert.ok(dup, 'possible duplicate detected');
const anil = find('Anil Nair');
assert.equal(t.missions.find(m => m.type === 'parents' && m.personIds[0] === anil.id)?.type, 'parents', 'two mothers => parents mission');

// Contributions: evidence, an alternative story version, a fact correction from someone who has not joined.
const story = mohan.stories[0];
const contributions = [
  { id: 'c1', kind: 'evidence', submittedAt: '2026-03-04T00:00:00Z', by: 'f2', missionId: yearMission.id, supports: '1952', text: 'His school certificate says 1952', source: 'document' },
  { id: 'c2', kind: 'story', submittedAt: '2026-03-05T00:00:00Z', by: 'f2', personId: mohan.id, replyTo: story.id, text: 'He walked, he only got the bicycle in college.', source: 'witnessed' },
  { id: 'c3', kind: 'fact', submittedAt: '2026-03-06T00:00:00Z', byName: 'Uncle Raj', personId: mohan.id, field: 'deathYear', value: '' },
];
t = buildTree(fam, contributions);
mohan = find('Mohan Nair');
const sm = t.missions.find(m => m.type === 'story');
assert.equal(sm.options.length, 2, 'two versions of the story');
assert.ok(mohan.stories.every(s => s.status === 'disputed'));
assert.equal(t.missions.find(m => m.id === yearMission.id).evidence[0].text, 'His school certificate says 1952');

// Admin decisions
const resolutions = [
  { missionId: yearMission.id, type: 'fact', decision: { value: 1952 }, note: 'School certificate', resolvedBy: 'Admin', resolvedAt: '2026-03-07T00:00:00Z' },
  { missionId: sm.id, type: 'story', decision: { main: sm.options[1].key }, resolvedBy: 'Admin', resolvedAt: '2026-03-07T00:00:00Z' },
  { missionId: dup.id, type: 'duplicate', decision: { same: true, personIds: dup.personIds }, resolvedBy: 'Admin', resolvedAt: '2026-03-07T00:00:00Z' },
];
t = buildTree(fam, contributions, resolutions);
mohan = find('Mohan Nair');
assert.equal(mohan.birthYear, 1952);
assert.equal(mohan.facts.birthYear.status, 'resolved');
assert.equal(mohan.claims.filter(c => c.field === 'birthYear').length, 3, 'other accounts still stored');
const main = mohan.stories.find(s => s.isMain);
assert.match(main.text, /walked/);
assert.equal(main.status, 'verified');
const seetha = find('Sita Nair');
assert.equal(seetha.id, find('Seetha Nair').id, 'merged');
assert.deepEqual(find('Anil Nair').parents.sort(), [mohan.id, seetha.id].sort());
assert.ok(!t.missions.some(m => m.type === 'parents' && m.status === 'open'), 'parent conflict disappears after merge');
assert.equal(t.redirects[dup.personIds.find(id => id !== seetha.id)], seetha.id);

// Reopening cancels a decision
t = buildTree(fam, contributions, [...resolutions, { missionId: yearMission.id, decision: { reopen: true }, resolvedAt: '2026-03-08T00:00:00Z' }]);
assert.equal(find('Mohan Nair').facts.birthYear.status, 'disputed');

console.log(`OK — ${tree.stats.people} people, ${tree.stats.contributors} contributors; missions: ${t.missions.map(m => m.type + ':' + m.status).join(', ')}`);
