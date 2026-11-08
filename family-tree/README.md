# 🌳 Family Tree

A self-organizing family tree website. Relatives open an invite link, answer a few simple
questions (name, parents, grandparents, siblings, spouse, children, roots), add photos and tap
faces to tag who's who. **Everything is stored in this GitHub repository**, and a GitHub Action
automatically connects every new entry into one tree. No manual work for admins.

## How it works

```
Relative's phone ──► Website (Vercel) ──► GitHub repo: family-tree/data/
                       │                    ├─ submissions/*.json  (one file per entry)
                       │                    ├─ photos/*.jpg
                       │                    └─ tree.json           (built automatically)
                       └── reads tree.json ◄── GitHub Action "Organize family tree"
```

1. Someone opens the invite link and fills in the step-by-step form (3 minutes, everything but their name is optional).
2. The website saves their answers as a JSON file and their photos as JPEGs in `family-tree/data/`.
3. The GitHub Action (`.github/workflows/family-tree.yml`) runs on every new entry and rebuilds `tree.json`:
   - matches names across entries ("Ramesh" from one cousin = "Ramesh Rao" from another, when they are close in the tree),
   - keeps people with the same first name apart when nothing connects them,
   - links parents ↔ children, spouses, siblings, and grandparents,
   - infers missing links (siblings share parents, a child's two parents are a couple),
   - lets people update their entry later (newest entry from the same phone wins; photos are kept).
4. After submitting, each person gets **their own invite link** to share on WhatsApp, text or email,
   so the tree spreads through the family by itself.

## One-time setup (about 10 minutes)

### 1. Keep the repository private
Family names and photos live in this repo. In GitHub: **Settings → General → Danger Zone → Change visibility → Private**.

### 2. Create a GitHub token for the website
GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
- Repository access: **Only select repositories** → this repo
- Permissions → Repository permissions → **Contents: Read and write**
- Copy the token (starts with `github_pat_`).

### 3. Allow the Action to save the tree
Repo **Settings → Actions → General → Workflow permissions → Read and write permissions** → Save.

### 4. Put the website online with Vercel (free)
1. Go to <https://vercel.com>, sign in with GitHub, **Add New → Project**, import this repository.
2. **Root Directory:** `family-tree`  ·  Framework Preset: **Other**.
3. Add **Environment Variables**:

   | Name | Value |
   |---|---|
   | `GITHUB_TOKEN` | the token from step 2 |
   | `GITHUB_REPO` | `your-github-name/your-repo-name` (e.g. `ananthaocad/sweepstakes-tracker`) |
   | `GITHUB_BRANCH` | `main` |
   | `FAMILY_KEY` | a secret word only the family will know, e.g. `rao-banyan-1947` (letters, numbers, dashes) |
   | `DATA_DIR` | `family-tree/data` |

4. Click **Deploy**. Vercel gives you an address like `https://family-tree-abc.vercel.app`.

### 5. Share it
Your admin link is:

```
https://YOUR-SITE.vercel.app/?k=YOUR_FAMILY_KEY
```

Open it once yourself, add yourself, then use **Invite** to send your personal link to your cousin.
From then on everybody invites everybody — nothing else to do.

## Personalizing
Edit `window.SITE` at the top of `public/index.html` to change the title and welcome line
(e.g. "The Rao Family Tree").

## Good to know
- **Privacy:** anyone with the link can view and add to the tree. If the link leaks, change
  `FAMILY_KEY` in Vercel (Settings → Environment Variables → redeploy) and share the new link.
- **Photos** are shrunk in the browser before upload (about 300 KB each), so a phone on mobile data is fine.
- **Mistakes:** a person can reopen the site on the same phone, tap *Update my details*, and resend.
  As the repo owner you can also edit or delete any file in `family-tree/data/submissions/` on GitHub;
  the tree rebuilds itself after every change.
- **Your data is portable:** it's plain JSON and JPEG files in your repo. Download the repo any time.
- Saving a new entry does not redeploy the website (`vercel.json` skips builds when only `data/` changed).

## Developing
```bash
cd family-tree
npm test                        # checks the tree-merging logic
node scripts/dev-server.js      # local site at http://localhost:3000/?k=test (writes to ./data)
node scripts/build-tree.js      # rebuild data/tree.json by hand
```
Files: `public/` website · `api/` serverless functions that read/write GitHub · `lib/merge.js` the
self-organizing logic · `scripts/` build, test and local server.
