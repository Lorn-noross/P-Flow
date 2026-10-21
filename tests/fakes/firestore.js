// Faux Firestore en mémoire, utilisé UNIQUEMENT par les tests (tests/vite.config.js).
// Il n'est jamais inclus dans l'appli publiée. Données de départ : window.__PFLOW_SEED__
// ({ "chemin/du/document": { champs } }). État lisible par le test : window.__PFLOW_DB__.
const store = new Map();
const listeners = new Set();
const SERVER_TS = { __serverTimestamp: true };
let writes = 0;
let ids = 0;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

const seed = (typeof window !== 'undefined' && window.__PFLOW_SEED__) || {};
for (const [p, d] of Object.entries(seed)) store.set(p, clone(d));
if (typeof window !== 'undefined') {
  window.__PFLOW_DB__ = {
    dump: () => Object.fromEntries(Array.from(store, ([k, v]) => [k, clone(v)])),
    writes: () => writes,
  };
}

export function initializeFirestore() { return { fake: true }; }
export function persistentLocalCache() { return {}; }
export function persistentMultipleTabManager() { return {}; }
export function serverTimestamp() { return SERVER_TS; }

const newId = () => 'gen' + (++ids);
export function collection(db, ...parts) { return { type: 'collection', path: parts.join('/') }; }
export function doc(base, ...parts) {
  if (base && base.type === 'collection') return { type: 'doc', path: base.path + '/' + (parts[0] || newId()) };
  return { type: 'doc', path: parts.join('/') };
}
export function where(field, op, value) { return { field, op, value }; }
export function query(coll, ...filters) { return { type: 'query', path: coll.path, filters }; }

function match(d, f) {
  const v = d[f.field];
  if (f.op === '>=') return v >= f.value;
  if (f.op === '<=') return v <= f.value;
  if (f.op === '==') return v === f.value;
  throw new Error('Opérateur non géré par le faux Firestore : ' + f.op);
}
function snapFor(ref) {
  const metadata = { hasPendingWrites: false, fromCache: false };
  if (ref.type === 'doc') {
    const d = store.get(ref.path);
    return { id: ref.path.split('/').pop(), exists: () => d !== undefined, data: () => clone(d), metadata };
  }
  const docs = [];
  for (const [k, d] of store) {
    if (!k.startsWith(ref.path + '/')) continue;
    const id = k.slice(ref.path.length + 1);
    if (id.includes('/')) continue;
    if (ref.filters && !ref.filters.every(f => match(d, f))) continue;
    docs.push({ id, data: () => clone(d) });
  }
  return { docs, size: docs.length, metadata };
}
export function onSnapshot(ref, opts, next) {
  if (typeof opts === 'function') next = opts;
  const l = { ref, next };
  listeners.add(l);
  setTimeout(() => { if (listeners.has(l)) next(snapFor(ref)); }, 0);
  return () => { listeners.delete(l); };
}
function notify() {
  setTimeout(() => { for (const l of Array.from(listeners)) if (listeners.has(l)) l.next(snapFor(l.ref)); }, 0);
}

// Comme le vrai Firestore : une valeur `undefined` est refusée (sinon un bug passerait inaperçu).
function resolve(v, path) {
  if (v === undefined) throw new Error('Valeur undefined refusée pour le champ ' + path);
  if (v === SERVER_TS) return Date.now();
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = resolve(v[k], path + '.' + k); return o; }
  return v;
}
function deepMerge(a, b) {
  const o = Object.assign({}, a);
  for (const k of Object.keys(b)) o[k] = isObj(b[k]) && isObj(o[k]) ? deepMerge(o[k], b[k]) : b[k];
  return o;
}
export async function setDoc(ref, data, opt) {
  const v = resolve(data, ref.path);
  store.set(ref.path, opt && opt.merge ? deepMerge(store.get(ref.path) || {}, v) : v);
  writes++;
  notify();
}
export async function addDoc(coll, data) {
  const ref = doc(coll);
  await setDoc(ref, data);
  return { id: ref.path.split('/').pop(), path: ref.path };
}
export async function deleteDoc(ref) {
  store.delete(ref.path);
  writes++;
  notify();
}
