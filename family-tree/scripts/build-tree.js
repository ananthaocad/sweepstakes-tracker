// Rebuilds data/tree.json from data/submissions/, data/contributions/ and data/resolutions/.
// Run by the GitHub Action after every change; can also be run by hand: `node scripts/build-tree.js`.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTree } from '../lib/merge.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function readAll(name) {
  const dir = join(dataDir, name);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    } catch (e) {
      console.warn(`Skipping unreadable ${name}/${f}: ${e.message}`);
    }
  }
  return out;
}

const submissions = readAll('submissions');
const contributions = readAll('contributions');
const resolutions = readAll('resolutions');
const tree = buildTree(submissions, contributions, resolutions);
tree.generatedAt = new Date().toISOString();
tree.submissionCount = submissions.length;
tree.contributionCount = contributions.length;
tree.resolutionCount = resolutions.length;
writeFileSync(join(dataDir, 'tree.json'), JSON.stringify(tree, null, 1) + '\n');
const st = tree.stats;
console.log(`Built tree: ${st.people} people, ${st.contributors} contributors, ${st.photos} photos, ${st.stories} stories, ${st.openMissions} open missions.`);
