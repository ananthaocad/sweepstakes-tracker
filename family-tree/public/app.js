/* Family tree site — no build step, no dependencies. */
(() => {
  'use strict';

  // ---------- small helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('ft.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ft.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const firstName = s => String(s || '').trim().split(/\s+/)[0] || '';
  const plural = (n, one, many = one + 's') => `${n || 0} ${n === 1 ? one : many}`;
  const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  const SITE = window.SITE || { title: 'Our Family Tree', tagline: '' };
  document.title = SITE.title;
  $('#site-title').textContent = SITE.title;

  // ---------- invite link handling: ?k=<family key>&from=<inviter> ----------
  const qs = new URLSearchParams(location.search);
  if (qs.get('k')) store.set('key', qs.get('k'));
  if (qs.get('from')) store.set('invitedBy', qs.get('from'));
  if (qs.get('admin')) store.set('adminKey', qs.get('admin'));
  if (qs.has('k') || qs.has('from') || qs.has('admin')) history.replaceState(null, '', location.pathname + location.hash);
  const ADMIN_KEY = store.get('adminKey');
  let isAdmin = false;
  const KEY = store.get('key');
  const clientId = store.get('clientId') || (() => { const id = uid(); store.set('clientId', id); return id; })();

  async function api(path, body) {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-family-key': KEY || '', ...(ADMIN_KEY ? { 'x-admin-key': ADMIN_KEY } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch { /* non-JSON error page */ }
    if (!r.ok) throw new Error((data && data.error) || `Something went wrong (${r.status}). Please try again.`);
    return data;
  }
  const photoUrl = path => `/api/photo?path=${encodeURIComponent(path)}&k=${encodeURIComponent(KEY || '')}`;

  // ---------- tree data ----------
  let tree = null;
  let treeError = null;
  let treeLoadedAt = 0;
  const byId = id => tree && tree.index && tree.index.get((tree.redirects && tree.redirects[id]) || id);
  const missionById = id => tree && (tree.missions || []).find(m => m.id === id);
  async function loadTree(force) {
    if (tree && !force && Date.now() - treeLoadedAt < 30000) return tree;
    try {
      tree = await api('/api/tree');
      treeLoadedAt = Date.now();
      treeError = null;
      tree.people = tree.people || [];
      tree.photos = tree.photos || [];
      tree.submissionToPerson = tree.submissionToPerson || {};
      tree.missions = tree.missions || [];
      tree.redirects = tree.redirects || {};
      tree.index = new Map(tree.people.map(p => [p.id, p]));
      const open = tree.missions.filter(m => m.status === 'open').length;
      $('#mission-count').textContent = open ? String(open) : '';
      if (ADMIN_KEY && !isAdmin) {
        try { isAdmin = (await api('/api/resolve')).admin; } catch { isAdmin = false; }
        document.body.classList.toggle('is-admin', isAdmin);
      }
      const dl = $('#known-names');
      dl.replaceChildren(...[...new Set(tree.people.map(p => p.name))].sort().map(n => h('option', { value: n })));
    } catch (e) {
      treeError = e.message;
      tree = tree || { people: [], photos: [], missions: [], redirects: {}, index: new Map(), submissionToPerson: {}, stats: {} };
    }
    return tree;
  }
  const me = () => store.get('me');
  const myPersonId = () => { const m = me(); return m && tree && tree.submissionToPerson[m.submissionId]; };
  const inviterName = () => {
    const from = store.get('invitedBy');
    const p = from && tree && byId(tree.submissionToPerson[from]);
    return p ? p.name : null;
  };
  function inviteLink() {
    const m = me();
    const u = new URL(location.origin + location.pathname);
    u.searchParams.set('k', KEY || '');
    if (m && m.submissionId) u.searchParams.set('from', m.submissionId);
    return u.toString();
  }

  // ---------- router ----------
  const app = $('#app');
  const routes = { '': viewHome, join: viewJoin, tree: viewTree, invite: viewInvite, done: viewDone, missions: viewMissions };
  async function render() {
    const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    if (!KEY) return app.replaceChildren(viewNoKey());
    app.replaceChildren(h('p', { class: 'loading' }, 'Loading…'));
    await loadTree();
    const view = routes[route] || viewHome;
    app.replaceChildren(await view(arg && decodeURIComponent(arg)));
  }
  window.addEventListener('hashchange', render);
  const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

  // ---------- views ----------
  function viewNoKey() {
    return h('section', { class: 'card center' },
      h('div', { class: 'big-emoji' }, '🔒'),
      h('h1', {}, 'This is a private family site'),
      h('p', {}, 'Please open the invite link a family member sent you. If you have lost it, ask them to send it again.'));
  }

  function viewHome() {
    const inviter = inviterName();
    const m = me();
    const stats = tree.stats || {};
    return h('div', {},
      h('section', { class: 'hero' },
        inviter && !m ? h('p', { class: 'pill' }, `👋 ${inviter} invited you`) : null,
        h('h1', {}, m ? `Welcome back, ${firstName(m.name)}!` : SITE.title),
        h('p', { class: 'lead' }, m ? 'Thank you for adding yourself. Invite more relatives so every branch gets filled in.' : SITE.tagline),
        h('div', { class: 'actions' },
          h('a', { class: 'btn primary big', href: '#/join' }, m ? '✏️ Update my details' : '➕ Add myself to the tree'),
          h('a', { class: 'btn big', href: '#/tree' }, '🌳 Explore the family tree'),
          h('a', { class: 'btn big', href: '#/invite' }, '💌 Invite family')),
        stats.people ? h('p', { class: 'muted stats' }, [plural(stats.people, 'person', 'people'), plural(stats.contributors, 'family member', 'family members') + ' joined', plural(stats.photos, 'photo'), plural(stats.stories || 0, 'story', 'stories')].join(' · ')) : null,
        treeError ? h('p', { class: 'error' }, treeError) : null),
      stats.openMissions ? h('a', { class: 'card mission-callout', href: '#/missions' },
        h('span', { class: 'big-emoji' }, '🔍'),
        h('span', {}, h('b', {}, `${plural(stats.openMissions, 'family mystery', 'family mysteries')} need${stats.openMissions === 1 ? 's' : ''} your help`),
          h('br'), h('span', { class: 'muted small' }, 'Relatives remember some things differently. Can you help work out what\'s right?'))) : null,
      h('section', { class: 'card how' },
        h('h2', {}, 'How it works'),
        h('ol', {},
          h('li', {}, h('b', {}, 'Add yourself'), ' — your name, your parents, grandparents, brothers & sisters, and children. Skip anything you don\'t know.'),
          h('li', {}, h('b', {}, 'Share a few photos'), ' — tap on faces to say who is who.'),
          h('li', {}, h('b', {}, 'Invite others'), ' — the tree connects everyone automatically as more relatives join.'),
          h('li', {}, h('b', {}, 'Share stories'), ' — write memories of parents and grandparents. When accounts differ, we keep every version and investigate together.'))));
  }

  // ---------- join wizard ----------
  const emptyRel = () => ({ name: '', deceased: false, notes: '' });
  function newDraft() {
    return {
      self: { name: '', gender: null, birthYear: '', location: '', birthPlace: '', about: '' },
      father: emptyRel(), mother: emptyRel(),
      fatherParents: { father: emptyRel(), mother: emptyRel() },
      motherParents: { father: emptyRel(), mother: emptyRel() },
      spouse: emptyRel(), siblings: [], children: [], origins: '', stories: [],
      profilePhotoPath: null, photos: [],
    };
  }
  let draft = Object.assign(newDraft(), store.get('draft') || {});
  // Photo pixels live only in memory; uploaded photos are remembered by their path.
  const photoData = new Map();
  let profileData = null;
  let refreshNext = () => {};
  function saveDraft() {
    store.set('draft', { ...draft, photos: draft.photos.filter(p => p.path) });
    refreshNext();
  }

  let step = 0;
  let flushers = [];
  const RELS = [
    ['father', 'Father', () => draft.father],
    ['mother', 'Mother', () => draft.mother],
    ['fatherFather', 'Father\'s father', () => draft.fatherParents.father],
    ['fatherMother', 'Father\'s mother', () => draft.fatherParents.mother],
    ['motherFather', 'Mother\'s father', () => draft.motherParents.father],
    ['motherMother', 'Mother\'s mother', () => draft.motherParents.mother],
  ];
  const newStory = about => ({ about, title: '', text: '', when: '', where: '', source: null, sourceDetail: '' });

  const STEPS = [
    {
      key: 'you',
      title: () => 'Let\'s start with you',
      sub: 'Only your name is required. Everything else is optional.',
      body: () => [
        field('Your full name', input(draft.self, 'name', { placeholder: 'e.g. Lakshmi Ramesh Rao', autocomplete: 'name', list: 'known-names', required: true })),
        field('You are', segmented(draft.self, 'gender', [['female', 'Female'], ['male', 'Male'], [null, 'Prefer not to say']])),
        h('div', { class: 'row' },
          field('Year born', input(draft.self, 'birthYear', { inputmode: 'numeric', placeholder: 'e.g. 1972', maxlength: 4 })),
          field('Where you live now', input(draft.self, 'location', { placeholder: 'City, country' }))),
        field('Where you were born', input(draft.self, 'birthPlace', { placeholder: 'Town or city' })),
      ],
      valid: () => draft.self.name.trim().length > 1 || 'Please enter your name.',
    },
    {
      key: 'parents',
      empty: () => !draft.father.name && !draft.mother.name,
      title: () => 'Your parents',
      sub: 'If someone has passed away, tick the box. You can add a short note about them too.',
      body: () => [relField('Father\'s name', draft.father), relField('Mother\'s name', draft.mother)],
    },
    {
      key: 'grandparents',
      empty: () => ![draft.fatherParents.father, draft.fatherParents.mother, draft.motherParents.father, draft.motherParents.mother].some(r => r.name),
      title: () => 'Your grandparents',
      sub: 'Write whatever you know — a first name is fine. Skip if you don\'t know.',
      body: () => [
        h('h3', { class: 'group' }, draft.father.name ? `${firstName(draft.father.name)}'s parents (father's side)` : 'Father\'s side'),
        relField('Grandfather', draft.fatherParents.father, 'Where they lived, their work, years…'),
        relField('Grandmother', draft.fatherParents.mother, 'Where they lived, their work, years…'),
        h('h3', { class: 'group' }, draft.mother.name ? `${firstName(draft.mother.name)}'s parents (mother's side)` : 'Mother\'s side'),
        relField('Grandfather', draft.motherParents.father, 'Where they lived, their work, years…'),
        relField('Grandmother', draft.motherParents.mother, 'Where they lived, their work, years…'),
      ],
    },
    {
      key: 'memories',
      empty: () => !draft.stories.some(st => st.text.trim()) && !RELS.some(([, , g]) => { const r = g(); return r.birthYear || r.birthPlace || r.deathYear; }),
      title: () => 'Memories of your parents & grandparents',
      sub: 'Share what you know: when and where they were born, and any stories — a habit, a saying, something they did. Everything is optional.',
      body: () => {
        const named = RELS.filter(([, , get]) => get().name.trim());
        if (!named.length) return [h('p', { class: 'note' }, 'You didn\'t add names for your parents or grandparents, so there\'s nothing to fill in here — just press Skip.')];
        return named.map(([about, label, get]) => memoryCard(about, label, get(), about === 'father' || about === 'mother'));
      },
    },
    {
      key: 'siblings',
      empty: () => !draft.siblings.length,
      title: () => 'Brothers & sisters',
      sub: 'Type a name and press Add (or Enter). Add as many as you have.',
      body: () => [chipInput(draft.siblings, 'Brother or sister\'s name')],
    },
    {
      key: 'spouse',
      empty: () => !draft.spouse.name && !draft.children.length,
      title: () => 'Your spouse & children',
      sub: 'Skip whatever doesn\'t apply.',
      body: () => [
        relField('Husband / wife / partner', draft.spouse),
        h('label', { class: 'label' }, 'Children'),
        chipInput(draft.children, 'Child\'s name'),
      ],
    },
    {
      key: 'roots',
      empty: () => !draft.origins && !draft.self.about,
      title: () => 'Family roots',
      sub: 'A sentence or two is plenty — this helps everyone understand where the family comes from.',
      body: () => [
        field('Where does your family come from?', textarea(draft, 'origins', 'Ancestral village or town, region, languages spoken, family stories, migrations…')),
        field('A little about you (optional)', textarea(draft.self, 'about', 'Work, interests, anything you\'d like relatives to know…')),
      ],
    },
    {
      key: 'photo',
      empty: () => !profileData && !draft.profilePhotoPath,
      title: () => 'Add a photo of yourself',
      sub: 'Optional, but it helps relatives recognise you.',
      body: () => [profilePicker()],
    },
    {
      key: 'photos',
      empty: () => !draft.photos.length,
      title: () => 'Share family photos',
      sub: 'Old photos are treasures! After adding, tap a face to say who it is — or tap names underneath.',
      body: () => [familyPhotos()],
    },
    {
      key: 'review',
      title: () => 'All set?',
      sub: 'Check everything looks right, then press Send.',
      body: () => [review()],
    },
  ];

  function viewJoin() {
    if (!draft.invitedBy && store.get('invitedBy')) draft.invitedBy = store.get('invitedBy');
    const wrap = h('section', { class: 'card wizard' });
    const draw = () => {
      flushers = [];
      const s = STEPS[step];
      const isLast = step === STEPS.length - 1;
      const err = h('p', { class: 'error', role: 'alert' });
      const next = () => {
        flushers.forEach(f => f());
        const ok = s.valid ? s.valid() : true;
        if (ok !== true) { err.textContent = ok; return; }
        saveDraft();
        if (isLast) return submit(wrap);
        step++; draw(); window.scrollTo(0, 0);
      };
      const nextBtn = h('button', { type: 'submit', class: 'btn primary' });
      refreshNext = () => { nextBtn.textContent = isLast ? 'Send ✓' : (s.empty && s.empty() ? 'Skip →' : 'Next →'); };
      refreshNext();
      wrap.replaceChildren(
        h('div', { class: 'progress', 'aria-hidden': 'true' }, h('div', { style: `width:${((step + 1) / STEPS.length) * 100}%` })),
        h('p', { class: 'muted small' }, `Step ${step + 1} of ${STEPS.length}`),
        h('h1', {}, s.title()),
        h('p', { class: 'lead' }, s.sub),
        h('form', { class: 'step', onsubmit: e => { e.preventDefault(); next(); } },
          ...s.body(),
          err,
          h('div', { class: 'nav-buttons' },
            step > 0 ? h('button', { type: 'button', class: 'btn', onclick: () => { flushers.forEach(f => f()); saveDraft(); step--; draw(); } }, '← Back') : h('span'),
            nextBtn)));
      const first = wrap.querySelector('input:not([type=checkbox]):not([type=file])');
      if (first && step === 0 && !first.value) first.focus();
    };
    draw();
    return wrap;
  }

  // ---------- form widgets ----------
  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control);
  }
  function input(obj, key, attrs = {}) {
    return h('input', { type: 'text', value: obj[key] || '', ...attrs, oninput: e => { obj[key] = e.target.value; saveDraft(); } });
  }
  function textarea(obj, key, placeholder) {
    const t = h('textarea', { rows: 4, placeholder, oninput: e => { obj[key] = e.target.value; saveDraft(); } });
    t.value = obj[key] || '';
    return t;
  }
  function segmented(obj, key, options, onChange) {
    const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
    const draw = () => wrap.replaceChildren(...options.map(([v, label]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(obj[key] === v), class: obj[key] === v ? 'on' : '', onclick: () => { obj[key] = v; saveDraft(); draw(); if (onChange) onChange(v); } }, label)));
    draw();
    return wrap;
  }
  function relField(label, rel, notePlaceholder = 'Anything you\'d like to share about them…') {
    const note = h('textarea', { rows: 2, placeholder: notePlaceholder, oninput: e => { rel.notes = e.target.value; saveDraft(); } });
    note.value = rel.notes || '';
    const noteWrap = h('div', { class: rel.notes ? '' : 'hidden' }, note);
    return h('div', { class: 'rel' },
      field(label, input(rel, 'name', { list: 'known-names', placeholder: 'Name', autocomplete: 'off' })),
      h('div', { class: 'rel-extras' },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: !!rel.deceased, onchange: e => { rel.deceased = e.target.checked; saveDraft(); } }),
          ' Passed away'),
        h('button', { type: 'button', class: 'link', onclick: () => { noteWrap.classList.toggle('hidden'); note.focus(); } }, '+ Add a note')),
      noteWrap);
  }
  const SOURCE_OPTIONS = [['witnessed', 'I was there'], ['told', 'Someone told me'], ['document', 'From a document']];
  /** A story / anecdote editor. Extra fields appear once something is written. */
  function storyEditor(st, onRemove, opts = {}) {
    const extra = h('div', { class: st.text || opts.expanded ? 'story-extra' : 'story-extra hidden' });
    const ta = h('textarea', { rows: opts.rows || 3, placeholder: opts.placeholder || 'A memory, a habit, a saying, something they did…', oninput: e => {
      st.text = e.target.value; if (st.text.trim()) extra.classList.remove('hidden'); saveDraft();
    } });
    ta.value = st.text || '';
    const detail = h('div');
    const drawDetail = () => detail.replaceChildren(
      st.source === 'told' ? field('Who told you?', input(st, 'sourceDetail', { placeholder: 'e.g. Grandma Sita' })) :
      st.source === 'document' ? field('Which document or photo?', input(st, 'sourceDetail', { placeholder: 'e.g. school certificate, letter, diary' })) : '');
    extra.append(
      field('Give it a title (optional)', input(st, 'title', { placeholder: 'e.g. "The bicycle to school"' })),
      h('div', { class: 'row' },
        field('When? (optional)', input(st, 'when', { placeholder: 'e.g. 1965, or "as a child"' })),
        field('Where? (optional)', input(st, 'where', { placeholder: 'Place' }))),
      field('How do you know this?', segmented(st, 'source', SOURCE_OPTIONS, drawDetail)),
      detail);
    drawDetail();
    return h('div', { class: 'story-edit' }, ta, extra,
      onRemove ? h('button', { type: 'button', class: 'link danger', onclick: onRemove }, 'Remove this story') : null);
  }

  function memoryCard(about, label, rel, starter) {
    const list = h('div', { class: 'stories-edit' });
    const draw = () => {
      const mine = draft.stories.filter(st => st.about === about);
      list.replaceChildren(...mine.map(st => storyEditor(st, () => { draft.stories.splice(draft.stories.indexOf(st), 1); saveDraft(); draw(); })));
    };
    if (starter && !draft.stories.some(st => st.about === about)) draft.stories.push(newStory(about));
    draw();
    return h('div', { class: 'rel memory' },
      h('h3', { class: 'group' }, rel.name, h('span', { class: 'muted small' }, ` · ${label}`)),
      h('div', { class: 'row three' },
        field('Year born', input(rel, 'birthYear', { inputmode: 'numeric', placeholder: 'e.g. 1948', maxlength: 4 })),
        field('Born in', input(rel, 'birthPlace', { placeholder: 'Town / village' })),
        rel.deceased ? field('Year passed away', input(rel, 'deathYear', { inputmode: 'numeric', placeholder: 'e.g. 2010', maxlength: 4 })) : null),
      list,
      h('button', { type: 'button', class: 'btn small', onclick: () => { draft.stories.push(newStory(about)); saveDraft(); draw(); } }, `+ Add a memory about ${firstName(rel.name)}`));
  }

  function chipInput(list, placeholder) {
    const chips = h('div', { class: 'chips' });
    const inp = h('input', { type: 'text', placeholder, list: 'known-names', autocomplete: 'off', enterkeyhint: 'enter' });
    const add = () => {
      for (const name of inp.value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)) {
        if (!list.some(r => norm(r.name) === norm(name))) list.push({ ...emptyRel(), name });
      }
      inp.value = '';
      saveDraft();
      draw();
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
    flushers.push(() => { if (inp.value.trim()) add(); });
    const draw = () => chips.replaceChildren(...list.map((r, i) =>
      h('span', { class: 'chip' }, r.name,
        h('button', { type: 'button', 'aria-label': `Remove ${r.name}`, onclick: () => { list.splice(i, 1); saveDraft(); draw(); } }, '×'))));
    draw();
    return h('div', { class: 'chip-input' }, h('div', { class: 'chip-row' }, inp, h('button', { type: 'button', class: 'btn', onclick: add }, 'Add')), chips);
  }

  // ---------- photos ----------
  async function resizeImage(file, max, square) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error(`Couldn't open "${file.name}". Please choose a JPG or PNG photo.`));
        i.src = url;
      });
      let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
      if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) * 0.3; sw = sh = s; }
      const scale = Math.min(1, max / Math.max(sw, sh));
      const c = h('canvas', { width: Math.round(sw * scale), height: Math.round(sh * scale) });
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function filePicker(label, multiple, onFiles) {
    const inp = h('input', { type: 'file', accept: 'image/*', multiple, class: 'visually-hidden', onchange: e => { onFiles([...e.target.files]); e.target.value = ''; } });
    return h('label', { class: 'dropzone' }, inp, h('span', { class: 'big-emoji' }, '📷'), h('span', {}, label));
  }

  function profilePicker() {
    const wrap = h('div', { class: 'profile-picker' });
    const draw = (msg) => {
      const src = profileData || (draft.profilePhotoPath && photoUrl(draft.profilePhotoPath));
      wrap.replaceChildren(
        src ? h('img', { class: 'avatar xl', src, alt: 'Your photo' }) : null,
        filePicker(src ? 'Choose a different photo' : 'Take or choose a photo', false, async ([f]) => {
          if (!f) return;
          draw('Preparing photo…');
          try { profileData = await resizeImage(f, 640, true); draft.profilePhotoPath = null; saveDraft(); draw(); } catch (e) { draw(e.message); }
        }),
        src ? h('button', { type: 'button', class: 'link', onclick: () => { profileData = null; draft.profilePhotoPath = null; saveDraft(); draw(); } }, 'Remove photo') : null,
        msg ? h('p', { class: 'muted' }, msg) : null);
    };
    draw();
    return wrap;
  }

  /** Everyone the person named in the form, for quick tagging. */
  function draftNames() {
    const d = draft;
    const out = [{ name: d.self.name || 'Me', self: true, label: 'Me' }];
    const add = (r, label) => { if (r && r.name && !out.some(o => norm(o.name) === norm(r.name))) out.push({ name: r.name.trim(), label }); };
    add(d.spouse, 'Spouse');
    d.children.forEach(r => add(r, 'Child'));
    add(d.father, 'Father');
    add(d.mother, 'Mother');
    d.siblings.forEach(r => add(r, 'Sibling'));
    add(d.fatherParents.father, 'Grandfather');
    add(d.fatherParents.mother, 'Grandmother');
    add(d.motherParents.father, 'Grandfather');
    add(d.motherParents.mother, 'Grandmother');
    return out;
  }

  function familyPhotos() {
    const wrap = h('div', { class: 'photos' });
    const status = h('p', { class: 'muted' });
    const list = h('div', { class: 'photo-list' });
    const drawList = () => list.replaceChildren(...draft.photos.map(ph => photoCard(ph, drawList)));
    wrap.append(
      filePicker('Add photos (you can pick several)', true, async files => {
        for (const [i, f] of files.entries()) {
          if (draft.photos.length >= 30) { status.textContent = 'That\'s the limit of 30 photos for now — thank you!'; break; }
          status.textContent = `Preparing photo ${i + 1} of ${files.length}…`;
          try {
            const id = uid();
            photoData.set(id, await resizeImage(f, 1600, false));
            draft.photos.push({ id, path: null, caption: '', tags: [] });
            drawList();
          } catch (e) { status.textContent = e.message; }
        }
        if (status.textContent.startsWith('Preparing')) status.textContent = '';
      }),
      status, list);
    drawList();
    return wrap;
  }

  function photoCard(ph, redrawAll) {
    const src = photoData.get(ph.id) || (ph.path && photoUrl(ph.path));
    const card = h('div', { class: 'photo-card' });
    const draw = () => {
      const img = h('img', { src, alt: ph.caption || 'Family photo', draggable: 'false' });
      const stage = h('div', { class: 'tagger', title: 'Tap a face to tag who it is' }, img,
        ...ph.tags.filter(t => t.x != null).map((t, i) => h('button', {
          type: 'button', class: 'tag-marker', style: `left:${t.x * 100}%;top:${t.y * 100}%`,
          title: 'Tap to remove', onclick: e => { e.stopPropagation(); ph.tags.splice(ph.tags.indexOf(t), 1); saveDraft(); draw(); },
        }, h('span', {}, t.self ? 'Me' : firstName(t.name)), ' ×')));
      stage.addEventListener('click', async e => {
        const r = img.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        const who = await pickName();
        if (!who) return;
        ph.tags = ph.tags.filter(t => norm(t.name) !== norm(who.name));
        ph.tags.push({ name: who.name, self: !!who.self, x, y });
        saveDraft(); draw();
      });
      const names = draftNames();
      const extra = ph.tags.filter(t => !names.some(n => norm(n.name) === norm(t.name)));
      const caption = h('input', { type: 'text', value: ph.caption, placeholder: 'Caption — e.g. "Wedding in Mysore, 1978"', oninput: e => { ph.caption = e.target.value; saveDraft(); } });
      card.replaceChildren(stage,
        h('p', { class: 'muted small' }, 'Who is in this photo? Tap faces above, or tap names:'),
        h('div', { class: 'chips toggles' },
          ...[...names, ...extra.map(t => ({ name: t.name }))].map(n => {
            const on = ph.tags.some(t => norm(t.name) === norm(n.name));
            return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => {
              if (on) ph.tags = ph.tags.filter(t => norm(t.name) !== norm(n.name));
              else ph.tags.push({ name: n.name, self: !!n.self, x: null, y: null });
              saveDraft(); draw();
            } }, on ? '✓ ' : '', n.label ? `${n.label === 'Me' ? 'Me' : n.name}` : n.name);
          }),
          h('button', { type: 'button', class: 'chip add', onclick: async () => {
            const who = await pickName(true);
            if (who && !ph.tags.some(t => norm(t.name) === norm(who.name))) { ph.tags.push({ name: who.name, self: !!who.self, x: null, y: null }); saveDraft(); draw(); }
          } }, '+ Someone else')),
        caption,
        h('button', { type: 'button', class: 'link danger', onclick: () => {
          draft.photos.splice(draft.photos.indexOf(ph), 1); photoData.delete(ph.id); saveDraft(); redrawAll();
        } }, 'Remove this photo'));
    };
    draw();
    return card;
  }

  /** Bottom sheet to choose who is in a photo. */
  function pickName(onlyOther) {
    return new Promise(resolve => {
      const done = v => { sheet.remove(); resolve(v); };
      const other = h('input', { type: 'text', placeholder: 'Type a name', list: 'known-names', autocomplete: 'off' });
      const sheet = h('div', { class: 'sheet-backdrop', onclick: e => { if (e.target === sheet) done(null); } },
        h('form', { class: 'sheet', onsubmit: e => { e.preventDefault(); if (other.value.trim()) done({ name: other.value.trim() }); } },
          h('h3', {}, 'Who is this?'),
          onlyOther ? null : h('div', { class: 'chips' }, ...draftNames().map(n =>
            h('button', { type: 'button', class: 'chip', onclick: () => done(n) }, n.label === 'Me' ? 'Me' : n.name))),
          h('div', { class: 'chip-row' }, other, h('button', { type: 'submit', class: 'btn primary' }, 'OK')),
          h('button', { type: 'button', class: 'link', onclick: () => done(null) }, 'Cancel')));
      document.body.append(sheet);
      if (onlyOther) other.focus();
    });
  }

  function review() {
    const d = draft;
    const line = (label, v) => (v ? h('div', { class: 'review-line' }, h('span', { class: 'muted' }, label), h('span', {}, v)) : null);
    const rel = r => (r && r.name ? r.name + (r.deceased ? ' 🕊' : '') : '');
    const jump = key => h('button', { type: 'button', class: 'link', onclick: () => { step = STEPS.findIndex(x => x.key === key); render(); } }, 'Edit');
    return h('div', { class: 'review' },
      h('div', { class: 'review-block' }, h('h3', {}, 'You ', jump('you')),
        line('Name', d.self.name), line('Born', [d.self.birthYear, d.self.birthPlace].filter(Boolean).join(', ')), line('Lives in', d.self.location)),
      h('div', { class: 'review-block' }, h('h3', {}, 'Family ', jump('parents')),
        line('Father', rel(d.father)), line('Mother', rel(d.mother)),
        line('Father\'s parents', [rel(d.fatherParents.father), rel(d.fatherParents.mother)].filter(Boolean).join(' & ')),
        line('Mother\'s parents', [rel(d.motherParents.father), rel(d.motherParents.mother)].filter(Boolean).join(' & ')),
        line('Brothers & sisters', d.siblings.map(rel).join(', ')),
        line('Spouse', rel(d.spouse)), line('Children', d.children.map(rel).join(', '))),
      d.origins ? h('div', { class: 'review-block' }, h('h3', {}, 'Roots ', jump('roots')), h('p', {}, d.origins)) : null,
      d.stories.some(st => st.text.trim()) ? h('div', { class: 'review-block' }, h('h3', {}, 'Memories ', jump('memories')),
        ...d.stories.filter(st => st.text.trim()).map(st => line(RELS.find(r => r[0] === st.about)?.[2]().name || '', st.title || st.text.slice(0, 60) + (st.text.length > 60 ? '…' : '')))) : null,
      h('div', { class: 'review-block' }, h('h3', {}, 'Photos ', jump('photos')),
        h('p', {}, `${(profileData || d.profilePhotoPath) ? 'Your photo + ' : ''}${d.photos.length} family photo${d.photos.length === 1 ? '' : 's'}`)));
  }

  async function submit(wrap) {
    const status = h('p', { class: 'lead' }, 'Sending…');
    const bar = h('div', { style: 'width:5%' });
    wrap.replaceChildren(h('h1', {}, 'Saving to the family tree'), h('div', { class: 'progress' }, bar), status);
    const pending = draft.photos.filter(p => !p.path && photoData.has(p.id));
    const total = pending.length + (profileData ? 1 : 0) + 1;
    let n = 0;
    const tick = msg => { n++; bar.style.width = `${(n / total) * 100}%`; status.textContent = msg; };
    try {
      if (profileData) {
        status.textContent = 'Uploading your photo…';
        draft.profilePhotoPath = (await api('/api/upload-photo', { image: profileData })).path;
        profileData = null; saveDraft(); tick('Uploaded your photo');
      }
      for (const [i, ph] of pending.entries()) {
        status.textContent = `Uploading photo ${i + 1} of ${pending.length}…`;
        ph.path = (await api('/api/upload-photo', { image: photoData.get(ph.id) })).path;
        saveDraft(); tick(`Uploaded photo ${i + 1} of ${pending.length}`);
      }
      draft.photos = draft.photos.filter(p => p.path);
      status.textContent = 'Saving your details…';
      const { profilePhotoPath, photos, stories, ...rest } = draft;
      const { id } = await api('/api/submit', {
        submission: {
          ...rest, clientId, profilePhoto: profilePhotoPath,
          photos: photos.map(p => ({ path: p.path, caption: p.caption, tags: p.tags })),
          stories: stories.filter(st => st.text.trim()),
        },
      });
      const prev = me();
      store.set('me', { submissionId: (prev && prev.submissionId) || id, latest: id, name: draft.self.name });
      saveDraft();
      step = 0;
      tree = null; // refetch so the new entry shows up as soon as it's organized
      go('#/done');
    } catch (e) {
      wrap.replaceChildren(
        h('h1', {}, 'That didn\'t work'),
        h('p', { class: 'error' }, e.message),
        h('p', {}, 'Nothing you entered has been lost.'),
        h('div', { class: 'nav-buttons' },
          h('button', { class: 'btn', onclick: () => render() }, '← Back to form'),
          h('button', { class: 'btn primary', onclick: () => submit(wrap) }, 'Try again')));
    }
  }

  function viewDone() {
    const m = me();
    return h('section', { class: 'card center' },
      h('div', { class: 'big-emoji' }, '🎉'),
      h('h1', {}, `Thank you, ${firstName(m && m.name)}!`),
      h('p', { class: 'lead' }, 'You\'ll appear in the tree in about a minute. The tree grows as more relatives join — please invite them!'),
      shareBox(),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/tree' }, '🌳 See the tree')));
  }

  // ---------- invite ----------
  function shareBox() {
    const link = inviteLink();
    const m = me();
    const msg = `${m ? `Hi! It's ${firstName(m.name)}. ` : 'Hi! '}We're building our family tree together. Please add yourself (takes 3 minutes) and invite others: ${link}`;
    const copied = h('span', { class: 'muted small' });
    return h('div', { class: 'share' },
      h('p', { class: 'label' }, 'Your personal invite link'),
      h('div', { class: 'chip-row' },
        h('input', { type: 'text', value: link, readonly: true, onclick: e => e.target.select() }),
        h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(link); copied.textContent = 'Copied!'; } catch { copied.textContent = 'Select the link and copy it.'; } } }, 'Copy')),
      copied,
      h('div', { class: 'share-buttons' },
        navigator.share ? h('button', { class: 'btn primary', onclick: () => navigator.share({ title: SITE.title, text: msg }).catch(() => {}) }, '📤 Share…') : null,
        h('a', { class: 'btn whatsapp', href: `https://wa.me/?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        h('a', { class: 'btn', href: `sms:?&body=${encodeURIComponent(msg)}` }, 'Text message'),
        h('a', { class: 'btn', href: `mailto:?subject=${encodeURIComponent(SITE.title)}&body=${encodeURIComponent(msg)}` }, 'Email')));
  }

  function viewInvite() {
    const m = me();
    return h('section', { class: 'card' },
      h('h1', {}, 'Invite family'),
      h('p', { class: 'lead' }, 'Send this link to any relative. They\'ll be guided through adding themselves, and can invite others too — the tree connects everyone automatically.'),
      m ? null : h('p', { class: 'note' }, 'Tip: ', h('a', { href: '#/join' }, 'add yourself first'), ' so people see who invited them.'),
      shareBox(),
      h('p', { class: 'muted small' }, 'Keep this link within the family — anyone with it can view the tree.'));
  }

  // ---------- tree ----------
  function personName(id) { const p = byId(id); return p ? p.name : ''; }
  function avatar(p, size = '') {
    if (p.photo) return h('img', { class: `avatar ${size}`, src: photoUrl(p.photo), alt: '', loading: 'lazy' });
    return h('span', { class: `avatar ${size} initials ${p.gender || ''}`, 'aria-hidden': 'true' }, initials(p.name));
  }
  function personCard(p, label, big) {
    if (!p) return null;
    const years = [p.birthYear, p.deceased ? '🕊' : null].filter(Boolean).join(' ');
    return h('a', { class: 'person' + (big ? ' focus' : '') + (p.selfSubmitted ? ' joined' : ''), href: `#/tree/${p.id}` },
      avatar(p, big ? 'lg' : ''),
      h('span', { class: 'pname' }, p.name),
      label ? h('span', { class: 'plabel' }, label) : null,
      years ? h('span', { class: 'pyears' }, years) : null);
  }
  function rowOf(title, people, labelFn) {
    const list = people.filter(Boolean);
    if (!list.length) return null;
    return h('div', { class: 'gen' }, h('h3', {}, title), h('div', { class: 'gen-row' }, ...list.map(p => personCard(p, labelFn && labelFn(p)))));
  }

  async function viewTree(focusId) {
    const people = tree.people;
    const wrap = h('div', { class: 'tree' });
    const m = me();
    if (m && !tree.submissionToPerson[m.latest || m.submissionId]) {
      wrap.append(h('p', { class: 'note' }, '⏳ Your latest entry is being added to the tree. ',
        h('button', { class: 'link', onclick: async () => { await loadTree(true); render(); } }, 'Refresh')));
    }
    if (treeError) wrap.append(h('p', { class: 'error' }, treeError));
    if (!people.length) {
      wrap.append(h('section', { class: 'card center' }, h('div', { class: 'big-emoji' }, '🌱'),
        h('h1', {}, 'The tree is just starting'), h('p', {}, 'Be the first to add yourself!'),
        h('a', { class: 'btn primary big', href: '#/join' }, '➕ Add myself')));
      return wrap;
    }
    const degree = p => p.parents.length + p.children.length + p.spouses.length + p.siblings.length;
    const focus = byId(focusId) || byId(myPersonId()) || [...people].sort((a, b) => degree(b) - degree(a))[0];
    const P = ids => ids.map(byId).filter(Boolean);

    const search = h('input', { type: 'search', placeholder: '🔍 Find someone…', list: 'known-names', 'aria-label': 'Find someone' });
    search.addEventListener('change', () => {
      const q = norm(search.value);
      const hit = people.find(p => norm(p.name) === q) || people.find(p => p.aliases.some(a => a.includes(q)));
      if (hit) go(`#/tree/${hit.id}`);
    });

    const parents = P(focus.parents);
    const gpRows = parents.map(par => rowOf(`${par.name}'s parents`, P(par.parents)));
    const grandkids = P(focus.children).flatMap(c => P(c.children));
    const relLabel = (p, role) => ({ parent: p.gender === 'male' ? 'Father' : p.gender === 'female' ? 'Mother' : 'Parent', child: p.gender === 'male' ? 'Son' : p.gender === 'female' ? 'Daughter' : 'Child', sibling: p.gender === 'male' ? 'Brother' : p.gender === 'female' ? 'Sister' : 'Sibling' })[role];

    wrap.append(
      h('div', { class: 'tree-tools' }, search,
        h('button', { class: 'btn small', onclick: async () => { await loadTree(true); render(); } }, '↻')),
      h('section', { class: 'card family-view' },
        h('div', { class: 'gp-rows' }, ...gpRows),
        rowOf('Parents', parents, p => relLabel(p, 'parent')),
        h('div', { class: 'gen center-gen' },
          h('div', { class: 'gen-row' }, personCard(focus, focus.id === myPersonId() ? 'You' : null, true),
            ...P(focus.spouses).map(s => personCard(s, 'Spouse')))),
        rowOf('Brothers & sisters', P(focus.siblings), p => relLabel(p, 'sibling')),
        rowOf('Children', P(focus.children), p => relLabel(p, 'child')),
        rowOf('Grandchildren', grandkids)),
      personDetails(focus),
      everyone());
    return wrap;
  }

  // ---------- labels ----------
  const FIELD_LABEL = { birthYear: 'Born', birthPlace: 'Born in', deathYear: 'Passed away', gender: 'Gender' };
  const SOURCE_LABEL = { witnessed: 'was there', told: 'was told', document: 'from a document', role: '' };
  const genderLabel = v => ({ male: 'Man', female: 'Woman' })[v] || v;
  function whoSaid(x) {
    if (x.self) return `${personName(x.by)} (about themselves)`;
    const name = x.by ? personName(x.by) : x.byName || 'Someone';
    const rel = x.relation && !['relative', 'someone', 'themselves'].includes(x.relation) ? ` (${x.relation})` : '';
    const src = x.source && SOURCE_LABEL[x.source] ? ` · ${SOURCE_LABEL[x.source]}` : '';
    const det = x.sourceDetail ? ` — ${x.sourceDetail}` : '';
    return name + rel + src + det;
  }
  function factBadge(f) {
    const m = f.missionId && missionById(f.missionId);
    const link = (cls, text) => (m ? h('a', { class: `badge ${cls}`, href: `#/missions/${m.id}` }, text) : h('span', { class: `badge ${cls}` }, text));
    if (f.status === 'disputed') return link('warn', '⚠ accounts differ');
    if (f.status === 'resolved' || f.status === 'verified') return link('ok', '✓ confirmed');
    if (f.accounts > 1) return h('span', { class: 'badge' }, `${f.accounts} agree`);
    return null;
  }

  function personDetails(p) {
    const photos = tree.photos.filter(ph => ph.tags.some(t => t.personId === p.id) || ph.uploadedBy === p.id);
    const facts = p.facts || {};
    const factRow = (field, extra) => {
      const f = facts[field];
      if (!f) return null;
      return h('p', { class: 'fact' }, h('span', { class: 'muted' }, FIELD_LABEL[field] + ' '),
        field === 'gender' ? genderLabel(f.value) : String(f.value), extra || '', ' ', factBadge(f),
        isAdmin && f.status === 'agreed' ? h('button', { class: 'link admin-only', onclick: () => resolveSheet({ id: f.missionId, type: 'fact', field, personIds: [p.id] }, { value: f.value }, `Confirm ${FIELD_LABEL[field].toLowerCase()} ${f.value}`) }, 'confirm') : null);
    };
    const shared = p.notes.map(n => h('blockquote', {}, n.text, n.by ? h('cite', {}, ` — shared by ${personName(n.by)}`) : null));
    const invitedBy = p.invitedBy && byId(p.invitedBy);
    const claims = p.claims.filter(c => c.source !== 'role');
    const groups = [...new Set(p.stories.map(st => st.versionOf || st.id))].map(root => p.stories.filter(st => (st.versionOf || st.id) === root));
    const others = (p.altParents || []).map(byId).filter(Boolean);
    return h('section', { class: 'card details' },
      h('div', { class: 'details-head' }, avatar(p, 'xl'),
        h('div', {}, h('h2', {}, p.name),
          p.aliases.length > 1 ? h('p', { class: 'muted small' }, 'Also written as: ', p.aliases.filter(a => a !== norm(p.name)).join(', ')) : null,
          factRow('birthYear'), factRow('birthPlace'), factRow('deathYear'),
          !facts.deathYear && p.deceased ? h('p', { class: 'fact' }, '🕊 Passed away') : null,
          p.location ? h('p', { class: 'fact' }, h('span', { class: 'muted' }, 'Lives in '), p.location) : null,
          p.selfSubmitted ? h('p', { class: 'muted small' }, '✓ Added themselves', invitedBy ? ` · invited by ${invitedBy.name}` : '')
            : (p.mentionedBy.length ? h('p', { class: 'muted small' }, `Added by ${p.mentionedBy.map(personName).join(', ')}`) : null))),
      claims.length > 1 ? h('details', { class: 'accounts' }, h('summary', {}, `Who said what (${claims.length} accounts)`),
        h('ul', {}, ...claims.map(c => h('li', {}, h('b', {}, `${FIELD_LABEL[c.field]} ${c.field === 'gender' ? genderLabel(c.value) : c.value}`), ' — ', whoSaid(c))))) : null,
      others.length ? h('p', { class: 'muted small' }, 'Also reported as a parent: ', ...others.map((o, i) => [i ? ', ' : '', h('a', { href: `#/tree/${o.id}` }, o.name)])) : null,
      p.about ? h('div', {}, h('h3', {}, 'About'), h('p', { class: 'pre' }, p.about)) : null,
      p.origins ? h('div', {}, h('h3', {}, 'Family roots'), h('p', { class: 'pre' }, p.origins)) : null,
      h('div', {}, h('h3', {}, 'Stories & memories'),
        groups.length ? groups.map(g => storyCard(p, g)) : h('p', { class: 'muted' }, `No stories about ${firstName(p.name)} yet.`)),
      shared.length ? h('div', {}, h('h3', {}, 'Notes'), ...shared) : null,
      h('div', { class: 'person-actions' },
        h('button', { class: 'btn', onclick: () => storyForm(p) }, `✍️ Add a memory about ${firstName(p.name)}`),
        h('button', { class: 'btn', onclick: () => factForm(p) }, '✏️ Suggest a correction')),
      photos.length ? h('div', {}, h('h3', {}, `Photos (${photos.length})`),
        h('div', { class: 'gallery' }, ...photos.map(ph => h('button', { class: 'thumb', onclick: () => lightbox(ph) },
          h('img', { src: photoUrl(ph.path), alt: ph.caption || 'Family photo', loading: 'lazy' }))))) : null,
      p.selfSubmitted ? null : h('p', { class: 'muted small' }, `Know ${firstName(p.name)}? `, h('a', { href: '#/invite' }, `Invite them to add their own details.`)));
  }

  // ---------- stories ----------
  const STORY_BADGE = { verified: ['ok', '✓ Verified'], disputed: ['warn', '⚠ Versions differ'], unverified: ['', 'Not yet verified'] };
  function storyBody(st, isMainView) {
    const [cls, text] = STORY_BADGE[st.status] || STORY_BADGE.unverified;
    const meta = [st.when, st.where].filter(Boolean).join(' · ');
    return [
      st.title ? h('h4', {}, st.title) : null,
      h('p', { class: 'pre' }, st.text),
      meta ? h('p', { class: 'muted small' }, meta) : null,
      h('p', { class: 'small byline' }, h('span', { class: 'muted' }, '— ', whoSaid({ by: st.by, byName: st.byName, source: st.source, sourceDetail: st.sourceDetail })), ' ',
        isMainView && st.isMain && st.missionId ? h('span', { class: 'badge ok' }, '★ Main version') : null, ' ',
        h('span', { class: `badge ${cls}` }, text)),
    ];
  }
  function storyCard(p, group) {
    const main = group.find(st => st.isMain) || group[0];
    const others = group.filter(st => st !== main);
    const m = main.missionId && missionById(main.missionId);
    return h('article', { class: 'story' },
      storyBody(main, true),
      others.length ? h('details', { class: 'versions' }, h('summary', {}, `${plural(others.length, 'other version')}`),
        ...others.map(v => h('div', { class: 'version' }, storyBody(v)))) : null,
      h('div', { class: 'story-actions' },
        h('button', { class: 'link', onclick: () => storyForm(p, main) }, '🗣 I remember it differently'),
        m ? h('a', { href: `#/missions/${m.id}` }, m.status === 'open' ? '🔍 Help investigate' : '🔍 Investigation') : null,
        isAdmin && main.status !== 'verified' ? h('button', { class: 'link admin-only', onclick: () => resolveSheet({ id: main.verifyMissionId, type: 'verify' }, { storyId: main.id, status: 'verified' }, 'Mark this story as verified') }, '✓ Mark verified') : null,
        isAdmin && main.status !== 'disputed' ? h('button', { class: 'link admin-only', onclick: () => resolveSheet({ id: main.verifyMissionId, type: 'verify' }, { storyId: main.id, status: 'disputed' }, 'Mark this story as disputed') }, '⚠ Mark disputed') : null));
  }

  // ---------- contributions (memories, corrections, evidence) ----------
  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 5000);
  }
  /** A bottom sheet with a form. `onSubmit` may throw to show an error. */
  function openSheet(title, body, onSubmit, submitLabel = 'Send') {
    const err = h('p', { class: 'error', role: 'alert' });
    const btn = h('button', { type: 'submit', class: 'btn primary' }, submitLabel);
    const close = () => sheet.remove();
    const form = h('form', { class: 'sheet', onsubmit: async e => {
      e.preventDefault();
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Sending…';
      try { await onSubmit(); close(); } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = submitLabel; }
    } }, h('h3', {}, title), ...[body].flat(), err,
      h('div', { class: 'nav-buttons' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), btn));
    const sheet = h('div', { class: 'sheet-backdrop', onclick: e => { if (e.target === sheet) close(); } }, form);
    document.body.append(sheet);
    const first = form.querySelector('textarea, input[type=text]');
    if (first) first.focus();
  }
  /** People who haven't joined are asked for their name, so the family knows who shared what. */
  function whoAmIField(state) {
    if (me()) return null;
    state.byName = store.get('guestName') || '';
    return field('Your name', input(state, 'byName', { placeholder: 'So the family knows who shared this' }));
  }
  async function sendContribution(payload) {
    const m = me();
    if (!m && !String(payload.byName || '').trim()) throw new Error('Please tell us your name.');
    if (!m) store.set('guestName', payload.byName.trim());
    await api('/api/contribute', { contribution: { ...payload, clientId, by: m ? m.submissionId : null } });
    treeLoadedAt = 0;
    toast('Thank you! It will appear in the tree in about a minute.');
  }
  function storyForm(p, replyTo) {
    const st = { title: replyTo ? replyTo.title : '', text: '', when: replyTo ? replyTo.when : '', where: replyTo ? replyTo.where : '', source: null, sourceDetail: '' };
    openSheet(replyTo ? 'How do you remember it?' : `A memory about ${firstName(p.name)}`, [
      replyTo ? h('blockquote', {}, replyTo.text, h('cite', {}, ` — ${whoSaid({ by: replyTo.by, byName: replyTo.byName })}`)) : null,
      replyTo ? h('p', { class: 'muted small' }, 'Both versions will be kept. The family can then investigate which one is right.') : null,
      storyEditor(st, null, { expanded: true, rows: 5, placeholder: replyTo ? 'Write your version…' : 'A memory, a habit, a saying, something they did…' }),
      whoAmIField(st),
    ], async () => {
      if (!st.text.trim()) throw new Error('Please write the story.');
      await sendContribution({ kind: 'story', personId: p.id, replyTo: replyTo ? replyTo.id : null, ...st });
    });
  }
  function factForm(p) {
    const st = { field: 'birthYear', value: '', source: null, sourceDetail: '' };
    const current = h('p', { class: 'muted small' });
    const showCurrent = () => { const f = p.facts && p.facts[st.field]; current.textContent = f ? `Currently shown: ${f.value}` : 'Nothing recorded yet.'; };
    showCurrent();
    openSheet(`Correct or add a detail about ${firstName(p.name)}`, [
      field('What would you like to correct?', segmented(st, 'field', [['birthYear', 'Year born'], ['birthPlace', 'Birthplace'], ['deathYear', 'Year passed away']], showCurrent)),
      current,
      field('What do you believe is right?', input(st, 'value', { placeholder: 'e.g. 1934, or a town name' })),
      field('How do you know this?', segmented(st, 'source', SOURCE_OPTIONS)),
      field('Details (optional)', input(st, 'sourceDetail', { placeholder: 'e.g. "his passport", "Aunt Uma told me"' })),
      h('p', { class: 'muted small' }, 'Nothing is overwritten. If accounts differ, an investigation is opened and an admin picks the main entry.'),
      whoAmIField(st),
    ], async () => {
      if (!st.value.trim()) throw new Error('Please fill in the value.');
      await sendContribution({ kind: 'fact', personId: p.id, ...st });
    });
  }

  // ---------- investigation missions ----------
  const MISSION_ICON = { fact: '📅', duplicate: '👥', parents: '👪', story: '📖' };
  function missionTitle(m) {
    const n = personName(m.personIds[0]);
    if (m.type === 'fact') return ({ birthYear: `In which year was ${n} born?`, birthPlace: `Where was ${n} born?`, deathYear: `In which year did ${n} pass away?`, gender: `Was ${n} a man or a woman?` })[m.field];
    if (m.type === 'duplicate') return m.personIds.length > 1 ? `Are ${personName(m.personIds[0])} and ${personName(m.personIds[1])} the same person?` : `${(m.mergedNames || []).filter(Boolean).join(' and ') || n}: confirmed as the same person`;
    if (m.type === 'parents') return `Who are ${n}'s parents?`;
    if (m.type === 'story') return `Which version of ${m.title ? `"${m.title}"` : 'the story'} about ${n} is right?`;
    return 'Investigation';
  }
  function missionExplain(m) {
    return ({
      fact: 'Relatives gave different answers. Every account is kept; the tree shows the most likely one until an admin confirms the main entry.',
      duplicate: 'These two entries have similar names and the same close relatives. They may be the same person written two ways.',
      parents: 'More parents were reported than expected — maybe a name was spelled two ways, or someone is a step-parent.',
      story: 'Relatives remember this story differently. All versions are kept; an admin picks the main version once it\'s checked.',
    })[m.type] || '';
  }
  const optLabel = (m, o) => (m.field === 'gender' ? genderLabel(o.value) : String(o.value));
  const isMainOption = (m, o) => (m.type === 'parents' ? o.kept && m.status === 'resolved' : m.main === o.key);
  const supports = (m, o, e) => e.supports && (e.supports === o.key || norm(e.supports) === norm(String(o.value)));
  function missionLink(m) { return inviteLink() + `#/missions/${m.id}`; }

  function viewMissions(id) {
    if (id) return missionView(missionById(id));
    const open = tree.missions.filter(m => m.status === 'open');
    const done = tree.missions.filter(m => m.status !== 'open');
    const row = m => h('a', { class: 'mission-row', href: `#/missions/${m.id}` },
      h('span', { class: 'big-emoji' }, MISSION_ICON[m.type] || '🔍'),
      h('span', {}, h('b', {}, missionTitle(m)), h('br'),
        h('span', { class: 'muted small' }, `${plural(m.options.length, 'version')} · ${plural(m.evidence.length, 'clue')}${m.helpers.length ? ` · ${plural(m.helpers.length, 'relative')} might know` : ''}`)));
    return h('div', {},
      h('section', { class: 'card' },
        h('h1', {}, '🔍 Family investigations'),
        h('p', { class: 'lead' }, 'When relatives remember things differently, nothing is thrown away. We keep every version, gather clues, and an admin marks the main entry once it can be verified.'),
        isAdmin ? h('p', { class: 'note' }, '🛡 You are an admin: open a mission to choose the main entry.') : null,
        open.length ? h('div', { class: 'mission-list' }, ...open.map(row)) : h('p', {}, '🎉 No open investigations right now.')),
      done.length ? h('details', { class: 'card' }, h('summary', {}, `Solved (${done.length})`), h('div', { class: 'mission-list' }, ...done.map(row))) : null);
  }

  function missionView(m) {
    if (!m) return h('section', { class: 'card' }, h('h1', {}, 'Investigation not found'), h('p', {}, 'It may have been solved and merged. '), h('a', { href: '#/missions' }, '← All investigations'));
    const open = m.status === 'open';
    const subjects = m.personIds.map(byId).filter(Boolean);
    const r = m.resolution;
    return h('div', { class: 'mission' },
      h('p', {}, h('a', { href: '#/missions' }, '← All investigations')),
      h('section', { class: 'card' },
        h('p', { class: `pill ${open ? 'warn' : 'ok'}` }, open ? '🔍 Open investigation' : '✓ Solved'),
        h('h1', {}, missionTitle(m)),
        h('p', { class: 'lead' }, missionExplain(m)),
        h('div', { class: 'gen-row' }, ...subjects.map(p => personCard(p))),
        r ? h('div', { class: 'resolution' },
          h('p', {}, h('b', {}, '✓ Decision: '), resolutionText(m), h('span', { class: 'muted small' }, ` — ${r.resolvedBy || 'Admin'}, ${String(r.resolvedAt || '').slice(0, 10)}`)),
          r.note ? h('p', { class: 'pre' }, r.note) : null,
          isAdmin ? h('button', { class: 'link admin-only', onclick: () => resolveSheet(m, { reopen: true }, 'Reopen this investigation') }, 'Reopen') : null) : null),
      h('section', { class: 'card' }, h('h2', {}, m.type === 'duplicate' ? 'The two entries' : 'The accounts'),
        m.type === 'duplicate' ? duplicateCompare(m) : m.options.map(o => optionCard(m, o)),
        isAdmin ? adminControls(m) : null),
      h('section', { class: 'card' }, h('h2', {}, `Clues (${m.evidence.length})`),
        m.evidence.length ? m.evidence.map(e => evidenceCard(m, e)) : h('p', { class: 'muted' }, 'No clues yet. Do you know something? Add it below.')),
      m.helpers.length ? helpersCard(m) : null,
      evidenceForm(m));
  }

  function resolutionText(m) {
    const d = (m.resolution || {}).decision || {};
    if (m.type === 'duplicate') return d.same ? 'they are the same person — the entries were merged.' : 'they are different people.';
    if (m.type === 'parents') return `parents are ${m.options.filter(o => o.kept).map(o => o.value).join(' & ')}.`;
    if (m.type === 'story') { const o = m.options.find(o => o.key === d.main); return o ? `the main version is "${o.value}".` : 'main version chosen.'; }
    return `${m.field === 'gender' ? genderLabel(d.value) : d.value}.`;
  }

  function optionCard(m, o) {
    const main = isMainOption(m, o);
    const ev = m.evidence.filter(e => supports(m, o, e));
    const st = m.type === 'story' && byId(m.personIds[0]) && byId(m.personIds[0]).stories.find(x => x.id === o.storyId);
    return h('div', { class: 'option' + (main ? ' main' : '') },
      h('div', { class: 'option-head' },
        m.type === 'parents' ? h('a', { href: `#/tree/${o.personId}` }, h('b', {}, o.value)) : h('b', {}, st && st.title ? st.title : optLabel(m, o)),
        main ? h('span', { class: `badge ${m.status === 'resolved' ? 'ok' : ''}` }, m.status === 'resolved' ? '★ Main entry' : 'Shown for now') : null,
        m.type === 'parents' && !o.kept ? h('span', { class: 'badge' }, 'not the main parent') : null),
      st ? h('p', { class: 'pre' }, st.text) : null,
      o.admin ? h('p', { class: 'muted small' }, 'Entered by an admin') : null,
      ...(o.claims || []).map(c => h('p', { class: 'small muted claim' }, '— ', whoSaid(c))),
      ev.length ? h('p', { class: 'small' }, `🧩 ${plural(ev.length, 'clue')} support${ev.length === 1 ? 's' : ''} this`) : null,
      isAdmin && m.type !== 'parents' && !(main && m.status === 'resolved') ? h('button', { class: 'btn small primary admin-only', onclick: () => resolveSheet(m,
        m.type === 'story' ? { main: o.key } : { value: o.value }, `Choose "${st && st.title ? st.title : optLabel(m, o)}" as the main entry`) }, 'Choose as main') : null);
  }

  function duplicateCompare(m) {
    const ps = m.personIds.map(byId).filter(Boolean);
    const rels = p => [['Parents', p.parents], ['Spouse', p.spouses], ['Children', p.children]]
      .filter(([, ids]) => ids.length).map(([k, ids]) => h('p', { class: 'small' }, h('span', { class: 'muted' }, k + ': '), ids.map(personName).join(', ')));
    return h('div', { class: 'compare' }, ...ps.map(p => h('div', { class: 'option' },
      personCard(p), p.birthYear ? h('p', { class: 'small' }, `Born ${p.birthYear}`) : null, ...rels(p),
      h('p', { class: 'small muted' }, p.selfSubmitted ? 'Added themselves' : `Added by ${p.mentionedBy.map(personName).join(', ') || 'someone'}`))),
      m.personIds.length < 2 ? h('p', {}, 'These entries have been merged into one person. All their details were kept.') : null);
  }

  function adminControls(m) {
    const wrap = h('div', { class: 'admin-box admin-only' }, h('h3', {}, '🛡 Admin decision'));
    if (m.type === 'duplicate' && m.personIds.length === 2) {
      const names = m.personIds.map(personName);
      wrap.append(h('div', { class: 'share-buttons' },
        h('button', { class: 'btn primary', onclick: () => resolveSheet(m, { same: true, personIds: m.personIds, names }, `Merge ${names.join(' and ')} into one person`) }, 'Same person — merge'),
        h('button', { class: 'btn', onclick: () => resolveSheet(m, { same: false, personIds: m.personIds, names }, 'Mark as different people') }, 'Different people')));
    } else if (m.type === 'parents') {
      const keep = new Set(m.options.filter(o => o.kept).map(o => o.key));
      wrap.append(h('p', { class: 'small' }, 'Tick the real parents (usually two):'),
        ...m.options.map(o => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: keep.has(o.key), onchange: e => { e.target.checked ? keep.add(o.key) : keep.delete(o.key); } }), ' ', o.value)),
        h('button', { class: 'btn primary', onclick: () => resolveSheet(m, { personId: m.personIds[0], keep: [...keep] }, 'Save the chosen parents') }, 'Save parents'));
    } else if (m.type === 'fact') {
      const st = { value: '' };
      wrap.append(field('Or enter the verified value', h('div', { class: 'chip-row' }, input(st, 'value', { placeholder: 'e.g. 1933' }),
        h('button', { class: 'btn', onclick: () => { if (st.value.trim()) resolveSheet(m, { value: st.value.trim() }, `Set the main entry to "${st.value.trim()}"`); } }, 'Use'))));
    } else {
      wrap.append(h('p', { class: 'small muted' }, 'Use "Choose as main" on the version that can be verified.'));
    }
    return wrap;
  }

  /** Admin confirms a decision with an optional note about the evidence. */
  function resolveSheet(m, decision, title) {
    const st = { note: '', resolvedBy: store.get('adminName') || (me() && me().name) || '' };
    openSheet(title, [
      field('Why? Note the evidence (optional)', textarea(st, 'note', 'e.g. "Birth certificate seen by Ravi, 2026"')),
      field('Your name', input(st, 'resolvedBy', { placeholder: 'Admin name' })),
      h('p', { class: 'muted small' }, decision.reopen ? 'The investigation will open again. Nothing is deleted.' : 'All other versions stay stored and visible.'),
    ], async () => {
      store.set('adminName', st.resolvedBy.trim());
      await api('/api/resolve', { resolution: { missionId: m.id, type: m.type, decision, note: st.note, resolvedBy: st.resolvedBy.trim() } });
      treeLoadedAt = 0;
      toast('Saved. The tree will update in about a minute.');
    }, 'Confirm');
  }

  function evidenceCard(m, e) {
    const o = e.supports && m.options.find(o => supports(m, o, e));
    return h('div', { class: 'evidence' },
      e.text ? h('p', { class: 'pre' }, e.text) : null,
      e.photo ? h('a', { href: photoUrl(e.photo), target: '_blank', rel: 'noopener', class: 'thumb doc' }, h('img', { src: photoUrl(e.photo), alt: 'Document or photo', loading: 'lazy' })) : null,
      h('p', { class: 'small muted' }, '— ', whoSaid(e), o ? ` · supports "${o.value}"` : e.supports ? ` · suggests "${e.supports}"` : ''));
  }

  function helpersCard(m) {
    const ask = hp => {
      const p = byId(hp.personId);
      const msg = `Hi ${firstName(p.name)}! Can you help with a family question? ${missionTitle(m)} ${missionLink(m)}`;
      return navigator.share ? h('button', { class: 'btn small', onclick: () => navigator.share({ text: msg }).catch(() => {}) }, 'Ask')
        : h('a', { class: 'btn small whatsapp', href: `https://wa.me/?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' }, 'Ask on WhatsApp');
    };
    return h('section', { class: 'card' }, h('h2', {}, 'Who might know?'),
      h('p', { class: 'muted small' }, 'Relatives close to this person who have joined the tree:'),
      ...m.helpers.map(hp => byId(hp.personId) && h('div', { class: 'helper' }, avatar(byId(hp.personId), 'sm'),
        h('span', {}, h('b', {}, byId(hp.personId).name), h('span', { class: 'muted small' }, ` · ${hp.relation}`)), ask(hp))));
  }

  function evidenceForm(m) {
    const st = { supports: null, text: '', source: null, sourceDetail: '' };
    let photo = null;
    const err = h('p', { class: 'error', role: 'alert' });
    const preview = h('div');
    const opts = [...m.options.map(o => [m.type === 'fact' ? String(o.value) : o.key, m.type === 'story' ? (byId(m.personIds[0])?.stories.find(x => x.id === o.storyId)?.title || o.value.slice(0, 40) + '…') : optLabel(m, o)]), [null, 'Not sure']];
    const btn = h('button', { type: 'submit', class: 'btn primary' }, 'Send clue');
    const form = h('form', { class: 'card', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (!st.text.trim() && !photo && !st.supports) { err.textContent = 'Please add what you know.'; return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const path = photo ? (await api('/api/upload-photo', { image: photo })).path : null;
        await sendContribution({ kind: 'evidence', missionId: m.id, ...st, photo: path });
        render();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Send clue'; }
    } },
      h('h2', {}, 'Add what you know'),
      field('Which is right, in your view?', segmented(st, 'supports', opts)),
      field('Your clue', textarea(st, 'text', 'Dates, names, documents, who would remember… Anything helps.')),
      filePicker('Add a photo of a document or picture (optional)', false, async ([f]) => {
        if (!f) return;
        try { photo = await resizeImage(f, 1600, false); preview.replaceChildren(h('img', { src: photo, class: 'doc-preview', alt: 'Selected document' })); } catch (ex) { err.textContent = ex.message; }
      }),
      preview,
      field('How do you know this?', segmented(st, 'source', SOURCE_OPTIONS)),
      field('Details (optional)', input(st, 'sourceDetail', { placeholder: 'e.g. "his school certificate", "my mother told me"' })),
      whoAmIField(st), err, btn);
    return form;
  }

  function everyone() {
    const people = [...tree.people].sort((a, b) => a.name.localeCompare(b.name));
    return h('details', { class: 'card everyone' },
      h('summary', {}, `Everyone in the tree (${people.length})`),
      h('ul', {}, ...people.map(p => h('li', {}, h('a', { href: `#/tree/${p.id}` }, avatar(p, 'sm'), p.name, p.selfSubmitted ? h('span', { class: 'joined-dot', title: 'Joined' }, ' ●') : null)))));
  }

  function lightbox(ph) {
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const label = t => (t.personId ? personName(t.personId) : t.name);
    const box = h('div', { class: 'lightbox', onclick: e => { if (e.target === box) close(); } },
      h('div', { class: 'lightbox-inner' },
        h('button', { class: 'close', 'aria-label': 'Close', onclick: close }, '×'),
        h('div', { class: 'tagger view' }, h('img', { src: photoUrl(ph.path), alt: ph.caption || 'Family photo' }),
          ...ph.tags.filter(t => t.x != null).map(t => h('span', { class: 'tag-marker', style: `left:${t.x * 100}%;top:${t.y * 100}%` }, label(t)))),
        ph.caption ? h('p', { class: 'caption' }, ph.caption) : null,
        ph.tags.length ? h('p', {}, 'In this photo: ', ...ph.tags.map((t, i) => [i ? ', ' : '',
          t.personId ? h('a', { href: `#/tree/${t.personId}`, onclick: close }, label(t)) : label(t)])) : null,
        h('p', { class: 'muted small' }, `Shared by ${personName(ph.uploadedBy)}`)));
    document.body.append(box);
  }

  render();
})();
