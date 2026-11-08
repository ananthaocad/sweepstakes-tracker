// Rebuilds data/tree.json from every file in data/submissions/. Run by the GitHub Action
// whenever someone submits; can also be run by hand: `node scripts/build-tree.js`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTree } from '../lib/merge.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const subDir = join(dataDir, 'submissions');

const submissions = [];
for (const f of readdirSync(subDir).filter(f => f.endsWith('.json')).sort()) {
  try {
    submissions.push(JSON.parse(readFileSync(join(subDir, f), 'utf8')));
  } catch (e) {
    console.warn(`Skipping unreadable submission ${f}: ${e.message}`);
  }
}

const tree = buildTree(submissions);
tree.generatedAt = new Date().toISOString();
tree.submissionCount = submissions.length;
writeFileSync(join(dataDir, 'tree.json'), JSON.stringify(tree, null, 1) + '\n');
console.log(`Built tree: ${tree.stats.people} people, ${tree.stats.contributors} contributors, ${tree.stats.photos} photos from ${submissions.length} submissions.`);
