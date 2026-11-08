// Minimal GitHub "contents" API client. Configure with environment variables on Vercel:
//   GITHUB_TOKEN  fine-grained token with Contents: read & write on the data repo
//   GITHUB_REPO   e.g. "your-name/your-repo"
//   GITHUB_BRANCH default "main"
//   DATA_DIR      folder in the repo for data, default "family-tree/data"
import { timingSafeEqual } from 'node:crypto';

export const DATA_DIR = (process.env.DATA_DIR || 'family-tree/data').replace(/\/+$/, '');
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || 'main';

function headers(accept = 'application/vnd.github+json') {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'family-tree-site',
  };
}

const url = path => `https://api.github.com/repos/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

export function configured() {
  return !!(process.env.GITHUB_TOKEN && REPO && process.env.FAMILY_KEY);
}

/** Returns the raw file as a Response (caller reads .json()/.arrayBuffer()), or null if missing. */
export async function getRaw(path) {
  const r = await fetch(`${url(path)}?ref=${encodeURIComponent(BRANCH)}`, { headers: headers('application/vnd.github.raw+json') });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read failed (${r.status}) for ${path}`);
  return r;
}

/** Creates a new file. Retries when GitHub reports a conflicting simultaneous commit. */
export async function createFile(path, base64Content, message) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url(path), {
      method: 'PUT',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: base64Content, branch: BRANCH }),
    });
    if (r.ok) return;
    if ((r.status === 409 || r.status >= 500) && attempt < 5) {
      await new Promise(res => setTimeout(res, 400 * 2 ** attempt + Math.random() * 300));
      continue;
    }
    throw new Error(`GitHub write failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  }
}

export function checkKey(req) {
  const given = String(req.headers['x-family-key'] || (req.query && req.query.k) || '');
  const expected = String(process.env.FAMILY_KEY || '');
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Common guard: method + config + key. Returns true if the request may continue. */
export function guard(req, res, method) {
  if (req.method !== method) { res.status(405).json({ error: 'Method not allowed' }); return false; }
  if (!configured()) { res.status(500).json({ error: 'Site is not set up yet (missing GITHUB_TOKEN, GITHUB_REPO or FAMILY_KEY).' }); return false; }
  if (!checkKey(req)) { res.status(401).json({ error: 'This link is not valid. Ask a family member for the invite link.' }); return false; }
  return true;
}

export function randomId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
