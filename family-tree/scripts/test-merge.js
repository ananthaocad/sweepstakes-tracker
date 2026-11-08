// Quick self-check for the tree-merging logic: `npm test`
import assert from 'node:assert/strict';
import { buildTree, normalizeName, fuzzyNameMatch } from '../lib/merge.js';

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

console.log(`OK — ${tree.stats.people} people, ${tree.stats.contributors} contributors`);
