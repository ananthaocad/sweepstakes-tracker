// Try the site locally without GitHub or Vercel:  node scripts/dev-server.js  ->  http://localhost:3000/?k=test
// GitHub API calls are redirected to the local data/ folder, and the tree is rebuilt after each submission
// (which is what the GitHub Action does in production).
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(root, '..');
process.env.GITHUB_TOKEN ||= 'local';
process.env.GITHUB_REPO ||= 'local/local';
process.env.FAMILY_KEY ||= 'test';
process.env.DATA_DIR ||= 'family-tree/data';

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const m = String(url).match(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)/);
  if (!m) return realFetch(url, opts);
  const file = join(repoRoot, decodeURIComponent(m[1]));
  if ((opts.method || 'GET') === 'PUT') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(JSON.parse(opts.body).content, 'base64'));
    if (file.includes('/submissions/')) execFileSync('node', [join(root, 'scripts/build-tree.js')], { stdio: 'inherit' });
    return new Response('{}', { status: 201 });
  }
  return existsSync(file) ? new Response(readFileSync(file)) : new Response('{}', { status: 404 });
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  res.send = b => res.end(b);
  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/[^a-z-]/g, '');
    req.query = Object.fromEntries(u.searchParams);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try { req.body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; } catch { req.body = {}; }
    try {
      const { default: handler } = await import(join(root, 'api', name + '.js'));
      return await handler(req, res);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
  const file = join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.replace(/\.\./g, ''));
  if (!existsSync(file)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(process.env.PORT || 3000, () => console.log(`Family tree running at http://localhost:${process.env.PORT || 3000}/?k=${process.env.FAMILY_KEY}`));
