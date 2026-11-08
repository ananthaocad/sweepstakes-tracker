// Input sanitizers shared by the API endpoints. Everything is trimmed and length-limited.
export const s = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const yearStr = v => { const n = parseInt(v, 10); return n > 1000 && n < 2200 ? String(n) : ''; };
export const SOURCES = ['witnessed', 'told', 'document'];
export const source = v => (SOURCES.includes(v) ? v : null);
export const FACT_FIELDS = ['birthYear', 'birthPlace', 'deathYear', 'gender'];
export const id = (v, prefix) => (typeof v === 'string' && new RegExp(`^${prefix}[A-Za-z0-9_]{1,40}$`).test(v) ? v : null);

export const rel = r => (r && typeof r === 'object' && s(r.name) ? {
  name: s(r.name, 120),
  deceased: r.deceased === true,
  notes: s(r.notes, 1000),
  birthYear: yearStr(r.birthYear),
  birthPlace: s(r.birthPlace),
  deathYear: yearStr(r.deathYear),
} : null);

export const story = st => (st && typeof st === 'object' && s(st.text, 5000) ? {
  title: s(st.title, 120),
  text: s(st.text, 5000),
  when: s(st.when, 80),
  where: s(st.where, 120),
  source: source(st.source),
  sourceDetail: s(st.sourceDetail, 300),
} : null);
