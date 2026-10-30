// Import de fichiers (patch 6) : tableau d'opérations (CSV, Excel .xlsx) et relevé de banque (CSV, Excel, OFX, QIF).
// Chargé à la demande (import() dynamique depuis main.js) : rien de tout ça au démarrage de l'appli.
// Lecture du .xlsx sans bibliothèque : le fichier est un zip (DecompressionStream « deflate-raw ») de fichiers XML
// (DOMParser). L'ancien format .xls n'est pas pris en charge (il faut l'enregistrer en .xlsx ou en CSV).
// Tout est fait sur l'appareil : le fichier n'est envoyé nulle part.

const pad = n => String(n).padStart(2, '0');
export const fold = s => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = s => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------- dates et montants ---------- */
function mk(y, mo, d) {
  if (!(y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 ? y + '-' + pad(mo) + '-' + pad(d) : null;
}
// Numéro de série Excel (jours depuis le 30/12/1899) : seulement dans une plage plausible (1968 à 2119).
function serialDate(n) {
  if (!(n > 25000 && n < 80000)) return null;
  const dt = new Date(Math.round((n - 25569) * 86400000));
  return mk(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
// « 12/10/2026 », « 12/10/26 », « 12-10-2026 », « 12.10.2026 », « 2026-10-12 », « 20261012 » (OFX), série Excel.
// Ordre français : jour puis mois.
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return serialDate(v);
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/))) return mk(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.\-'](\d{1,2})[/.\-'](\d{2,4})(?!\d)/))) { let y = +m[3]; if (y < 100) y += 2000; return mk(y, +m[2], +m[1]); }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return mk(+m[1], +m[2], +m[3]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return serialDate(+s);
  return null;
}
// « 1 234,56 », « -12,50 », « 12,50- », « (12,50) », « 1.234,56 », « 1,234.56 », « 12,50 € », « −12,50 ».
export function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = String(v == null ? '' : v).trim();
  if (!s) return null;
  s = s.replace(/[\s  ]/g, '').replace(/€|eur(os)?/gi, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[-−–]/.test(s)) { neg = true; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
  if (/[-−]$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isFinite(n) ? Math.round((neg ? -n : n) * 100) / 100 : null;
}

/* ---------- lecture du fichier ---------- */
function decodeText(buf) {
  let t;
  try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { t = new TextDecoder('windows-1252').decode(buf); } // banques : souvent en Latin-1
  return t.replace(/^﻿/, '');
}
const ext = name => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
// Renvoie { kind: 'rows', sheets: [{ name, rows }] } (CSV, Excel) ou { kind: 'ops', ops, balance } (OFX, QIF).
export async function readImport(file) {
  if (file.size > 15e6) throw new Error('Ce fichier est trop gros (15 Mo au plus).');
  const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf), e = ext(file.name);
  if (e === 'xls' && !(u8[0] === 0x50 && u8[1] === 0x4b)) throw new Error('Ancien format Excel (.xls) : ouvre-le et enregistre-le en .xlsx ou en CSV.');
  if (u8[0] === 0x50 && u8[1] === 0x4b) return { kind: 'rows', sheets: await readXlsx(buf) };
  const text = decodeText(buf);
  if (e === 'ofx' || e === 'qfx' || /<OFX>|<STMTTRN>/i.test(text.slice(0, 4000))) return Object.assign({ kind: 'ops' }, parseOfx(text));
  if (e === 'qif' || /^!Type:/im.test(text.slice(0, 200))) return { kind: 'ops', ops: parseQif(text), balance: null };
  return { kind: 'rows', sheets: [{ name: '', rows: parseCsv(text) }] };
}

/* ----- CSV ----- */
function countFields(line, sep) {
  let n = 1, q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === sep && !q) n++; }
  return n;
}
export function parseCsv(text) {
  const sample = text.slice(0, 8000).split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
  let sep = ';', best = -1;
  for (const c of [';', ',', '\t', '|']) {
    const counts = sample.map(l => countFields(l, c)), freq = {};
    counts.forEach(x => { freq[x] = (freq[x] || 0) + 1; });
    const mode = +Object.keys(freq).sort((a, b) => freq[b] - freq[a] || b - a)[0];
    const score = mode > 1 ? freq[mode] * 10 + mode : 0;
    if (score > best) { best = score; sep = c; }
  }
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && !cell.trim()) { q = true; cell = ''; }
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.replace(/\s+/g, ' ').trim())).filter(r => r.some(c => c !== ''));
}

/* ----- Excel (.xlsx) ----- */
async function inflate(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Cet appareil ne sait pas lire les fichiers Excel : enregistre le tableau en CSV.');
  let ds;
  try { ds = new DecompressionStream('deflate-raw'); } catch (e) { throw new Error('Cet appareil ne sait pas lire les fichiers Excel : enregistre le tableau en CSV.'); }
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
}
async function unzip(buf, want) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let e = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Ce fichier Excel est abîmé ou protégé par un mot de passe.');
  const n = dv.getUint16(e + 10, true), out = new Map();
  let p = dv.getUint32(e + 16, true);
  for (let k = 0; k < n && p + 46 <= buf.byteLength; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (!want(name)) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), data = u8.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflate(data));
  }
  return out;
}
const xml = bytes => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
const tags = (node, t) => Array.from(node.getElementsByTagName(t));
const colIdx = ref => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const c of m[1]) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
async function readXlsx(buf) {
  const files = await unzip(buf, n => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  if (!files.has('xl/workbook.xml')) throw new Error('Ce fichier n\'est pas un tableau Excel (.xlsx).');
  const strings = files.has('xl/sharedStrings.xml')
    ? tags(xml(files.get('xl/sharedStrings.xml')), 'si').map(si => tags(si, 't').filter(t => t.parentNode.nodeName !== 'rPh').map(t => t.textContent).join(''))
    : [];
  const rels = {};
  if (files.has('xl/_rels/workbook.xml.rels')) for (const r of tags(xml(files.get('xl/_rels/workbook.xml.rels')), 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const sheets = [];
  for (const s of tags(xml(files.get('xl/workbook.xml')), 'sheet')) {
    let t = rels[s.getAttribute('r:id')] || '';
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    const f = files.get(t); if (!f) continue;
    const rows = [];
    for (const r of tags(xml(f), 'row')) {
      const row = [];
      for (const c of tags(r, 'c')) {
        const i = colIdx(c.getAttribute('r')), ty = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        let val = '';
        if (ty === 's') val = v ? strings[+v.textContent] || '' : '';
        else if (ty === 'inlineStr') val = tags(c, 't').map(x => x.textContent).join('');
        else if (ty === 'str' || ty === 'b' || ty === 'e') val = v ? v.textContent : '';
        else if (v && v.textContent !== '') { const n = parseFloat(v.textContent); val = isFinite(n) ? n : v.textContent; }
        const at = i >= 0 ? i : row.length;
        while (row.length < at) row.push('');
        row[at] = typeof val === 'string' ? val.replace(/\s+/g, ' ').trim() : val;
      }
      if (row.some(x => x !== '')) rows.push(row);
    }
    sheets.push({ name: s.getAttribute('name') || '', rows });
  }
  if (!sheets.length) throw new Error('Aucune feuille lisible dans ce fichier Excel.');
  return sheets;
}

/* ----- OFX et QIF ----- */
const unent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&amp;/g, '&');
export function parseOfx(text) {
  const tag = (b, t) => { const m = b.match(new RegExp('<' + t + '>([^<\\r\\n]*)', 'i')); return m ? unent(m[1].trim()) : ''; };
  const ops = [];
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
  let m;
  while ((m = re.exec(text))) {
    const b = m[1], date = parseDate(tag(b, 'DTPOSTED')), amount = parseNum(tag(b, 'TRNAMT'));
    const name = tag(b, 'NAME'), memo = tag(b, 'MEMO');
    const label = memo && (!name || (memo.length > name.length && fold(memo).startsWith(fold(name)))) ? memo : name || memo;
    if (date && amount != null && amount !== 0) ops.push({ date, amount, label, ref: tag(b, 'FITID') });
  }
  const lb = text.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|$)/i);
  let balance = null;
  if (lb) { const a = parseNum(tag(lb[1], 'BALAMT')), d = parseDate(tag(lb[1], 'DTASOF')); if (a != null && d) balance = { montant: a, date: d }; }
  return { ops, balance };
}
export function parseQif(text) {
  const ops = []; let cur = {};
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    const c = l[0], v = l.slice(1).trim();
    if (c === '!') continue;
    if (c === '^') { if (cur.date && cur.amount) ops.push({ date: cur.date, amount: cur.amount, label: cur.label || cur.memo || '' }); cur = {}; }
    else if (c === 'D') cur.date = parseDate(v.replace(/\s/g, ''));
    else if (c === 'T' || c === 'U') cur.amount = parseNum(v);
    else if (c === 'P') cur.label = v;
    else if (c === 'M') cur.memo = v;
  }
  if (cur.date && cur.amount) ops.push({ date: cur.date, amount: cur.amount, label: cur.label || cur.memo || '' });
  return ops;
}

/* ---------- colonnes devinées ---------- */
// En-têtes connus (banques françaises et tableaux faits main), comparés sans accents ni ponctuation.
const HEAD = {
  date: ['date operation', 'date de l operation', 'date d operation', 'dateop', 'date', 'date comptable', 'date de comptabilisation', 'jour', 'le'],
  label: ['libelle simplifie', 'libelle', 'label', 'libelle operation', 'libelle de l operation', 'description', 'operation', 'detail', 'details', 'intitule', 'beneficiaire', 'tiers', 'designation', 'objet', 'quoi', 'nom', 'motif'],
  amount: ['montant', 'amount', 'montant de l operation', 'montant euros', 'montant eur', 'montant en euros', 'somme', 'prix', 'valeur'],
  debit: ['debit', 'debit euros', 'debits', 'sortie', 'sorties', 'depense', 'depenses', 'montant debit'],
  credit: ['credit', 'credit euros', 'credits', 'entree', 'entrees', 'recette', 'recettes', 'montant credit'],
  type: ['type', 'sens', 'type d operation', 'type operation'],
  balance: ['solde', 'accountbalance', 'balance', 'solde apres operation', 'solde du compte', 'solde euros'],
};
function headScore(cell, k) {
  const w = words(cell); if (!w || /\d{2}/.test(w)) return 0;
  let best = 0;
  for (const h of HEAD[k]) {
    if (w === h) return 4;
    if (w.replace(/ /g, '') === h.replace(/ /g, '')) best = Math.max(best, 4);
    else if (w.startsWith(h + ' ') || w.endsWith(' ' + h)) best = Math.max(best, 2);
  }
  return best;
}
const ORDER = ['date', 'amount', 'debit', 'credit', 'label', 'balance', 'type'];
// Renvoie { head : index de la ligne d'en-têtes (−1 sans), names : noms des colonnes, map : { date, label, amount, debit,
// credit, balance, type } (index de colonne ou −1) }.
export function guessColumns(rows) {
  const width = Math.max(0, ...rows.slice(0, 60).map(r => r.length));
  let head = -1, hs = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const s = rows[i].reduce((a, c) => a + (typeof c === 'string' && ORDER.some(k => headScore(c, k) >= 2) ? 1 : 0), 0);
    if (s >= 2 && s > hs) { hs = s; head = i; }
  }
  const data = rows.slice(head + 1).filter(r => r.filter(c => c !== '').length >= 2).slice(0, 80);
  const map = { date: -1, label: -1, amount: -1, debit: -1, credit: -1, balance: -1, type: -1 };
  const used = new Set();
  if (head >= 0) {
    for (const k of ORDER) {
      let bi = -1, bs = 0;
      rows[head].forEach((c, i) => { if (used.has(i)) return; const s = headScore(c, k); if (s > bs) { bs = s; bi = i; } });
      if (bi >= 0 && bs >= 2) { map[k] = bi; used.add(bi); }
    }
  }
  // Sans en-tête reconnu : d'après le contenu (dates, nombres, texte).
  const stat = i => {
    let d = 0, n = 0, t = 0, len = 0;
    for (const r of data) { const v = r[i]; if (v === '' || v == null) continue; if (parseDate(v)) d++; else if (parseNum(v) != null) n++; else { t++; len += String(v).length; } }
    const tot = data.length || 1;
    return { d: d / tot, n: n / tot, t: t / tot, len: t ? len / t : 0 };
  };
  const st = Array.from({ length: width }, (_, i) => stat(i));
  const pick = (k, f) => { if (map[k] >= 0) return; let bi = -1, bs = 0; st.forEach((s, i) => { if (used.has(i)) return; const v = f(s); if (v > bs) { bs = v; bi = i; } }); if (bi >= 0 && bs > 0.5) { map[k] = bi; used.add(bi); } };
  pick('date', s => s.d);
  if (map.debit < 0 || map.credit < 0) pick('amount', s => s.n);
  pick('label', s => s.t + s.len / 100);
  if (map.amount >= 0 && map.debit >= 0 && map.credit >= 0) { map.debit = -1; map.credit = -1; }
  const names = Array.from({ length: width }, (_, i) => (head >= 0 && rows[head][i] ? String(rows[head][i]) : 'Colonne ' + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '')));
  return { head, names, map, width };
}
// Opérations d'un tableau : { date, amount (signé : + rentrée, − sortie), label, bal } ; bad = lignes illisibles.
// sign : 'auto' (montants signés, ou colonne Type) ; quand tous les montants sont positifs sans colonne Type,
// `positive` dit ce qu'ils sont ('depense' ou 'revenu').
export function rowsToOps(rows, g, positive) {
  const M = g.map, ops = [];
  let bad = 0, anyNeg = false;
  const typeOf = v => { const w = words(v); return /\b(revenu|revenus|recette|recettes|credit|entree|gain|salaire|encaissement|rentree)\b/.test(w) ? 1 : /\b(depense|depenses|debit|sortie|achat|paiement|decaissement)\b/.test(w) ? -1 : 0; };
  for (const r of rows.slice(g.head + 1)) {
    if (r.filter(c => c !== '').length < 2) continue;
    const date = parseDate(r[M.date]);
    const label = String(r[M.label] == null ? '' : r[M.label]).trim();
    let amount = null;
    if (M.amount >= 0) amount = parseNum(r[M.amount]);
    else if (M.debit >= 0 || M.credit >= 0) {
      const c = M.credit >= 0 ? parseNum(r[M.credit]) : null, d = M.debit >= 0 ? parseNum(r[M.debit]) : null;
      if (c != null || d != null) amount = Math.round(((c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0)) * 100) / 100;
    }
    if (!date || amount == null || amount === 0 || !label) { bad++; continue; }
    if (amount < 0) anyNeg = true;
    const t = M.type >= 0 ? typeOf(r[M.type]) : 0;
    ops.push({ date, amount, label, t, bal: M.balance >= 0 ? parseNum(r[M.balance]) : null });
  }
  // Montants signés (ou colonnes Débit / Crédit) : le signe fait foi. Sinon la colonne Type, sinon `positive`.
  const signed = anyNeg || M.amount < 0, hasT = ops.some(o => o.t);
  for (const o of ops) {
    if (!signed) o.amount = Math.abs(o.amount) * (o.t ? o.t : positive === 'revenu' ? 1 : -1);
    delete o.t;
  }
  return { ops, bad, needSign: !signed && !hasT };
}
// Solde lu dans la colonne Solde : celui de la ligne la plus récente (la dernière de ce jour-là dans le fichier).
export function balanceOf(ops) {
  let best = null;
  for (const o of ops) if (o.bal != null && (!best || o.date >= best.date)) best = { montant: o.bal, date: o.date };
  return best;
}

/* ---------- libellés de banque ---------- */
// « PRLV SEPA EDF SA » → « EDF SA » ; « CB CARREFOUR 12/10 » → « Carrefour » ;
// « VIR SEPA RECU /DE EMPLOYEUR SAS /MOTIF SALAIRE » → « Employeur SAS ».
const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'a', 'au', 'aux', 'en', 'sur', 'pour', 'chez']);
export function cleanLabel(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^retrait(\s+dab)?\b/i.test(s)) return 'Retrait espèces';
  const parts = s.split(/\s\/(?=[A-Za-z]{2,}\b)|\s\/\s/);
  if (parts.length > 1) {
    const de = parts.find(p => /^de\s/i.test(p.trim()));
    s = (de ? de.trim().replace(/^de\s+/i, '') : parts[0]).trim() || s;
  }
  s = s.replace(/^(prlv|prelevement|prélèvement)(\s+(sepa|europeen|européen))?\b/i, '')
    .replace(/^(paiement|paiemt)(\s+(par\s+)?(carte|cb))?\b/i, '')
    .replace(/^(carte|cb)\b\s*(x\s?\d{4}|\*?\d{4,})?/i, '')
    .replace(/^(vir|virement)(\s+(sepa|inst|instantane|instantané|permanent))?(\s+(recu|reçu|emis|émis))?\b/i, '')
    .replace(/\b(x\s?\d{4})\b/gi, ' ')
    .replace(/\b(cb)?\*\d+\b/gi, ' ')
    .replace(/\b\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\b/g, ' ')
    .replace(/\b(ref|motif|ech|echeance|mandat|rum|ics|fact)\b[ :.]*\S*/gi, ' ')
    .replace(/\b[A-Za-z]*\d[A-Za-z0-9]{4,}\b/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/^[\s:*.\-/]+|[\s:*.\-/]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  if (!s) s = String(raw).trim().slice(0, 40);
  const ws = s.split(' ').slice(0, 5);
  return ws.map((w, i) => {
    const lw = w.toLowerCase();
    if (i > 0 && SMALL.has(fold(lw))) return lw;
    if (w.length <= 4 && w === w.toUpperCase() && /[A-Z]/.test(w) && !SMALL.has(fold(lw))) return w; // sigles : EDF, SFR, CAF
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(' ');
}

/* ---------- identifiants et fixes ---------- */
// Empreinte courte et stable (cyrb53) : même ligne → même identifiant, donc réimporter ne crée aucun doublon.
export function hash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
// Identifiants des lignes : deux lignes identiques (deux cafés le même jour) gardent chacune le leur.
export function lineIds(ops, prefix) {
  const seen = {};
  return ops.map(o => {
    const base = o.date + '|' + o.amount + '|' + words(o.label) + (o.ref ? '|' + o.ref : '');
    const k = seen[base] = (seen[base] || 0) + 1;
    return prefix + hash(base + '|' + k);
  });
}
// Fixes repérés dans un relevé : même libellé nettoyé, même sens, même montant (à 1 € près), au moins 2 mois différents.
// lines : [{ i, date, amount, key, label }] → [{ key, label, amount, type, day, start, months, idx: [i…] }]
export function detectFixes(lines) {
  const groups = new Map();
  for (const l of lines) {
    if (!l.key) continue;
    const k = l.key + (l.amount > 0 ? '+' : '-');
    (groups.get(k) || groups.set(k, []).get(k)).push(l);
  }
  const out = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    const used = new Set();
    for (const ref of arr) {
      if (used.has(ref)) continue;
      const cl = arr.filter(x => !used.has(x) && Math.abs(Math.abs(x.amount) - Math.abs(ref.amount)) <= 1);
      const months = new Set(cl.map(x => x.date.slice(0, 7)));
      if (months.size < 2 || cl.length > months.size + 1) continue; // plusieurs fois par mois : pas un fixe mensuel
      cl.forEach(x => used.add(x));
      const days = {}; cl.forEach(x => { const d = +x.date.slice(8, 10); days[d] = (days[d] || 0) + 1; });
      const day = +Object.keys(days).sort((a, b) => days[b] - days[a] || a - b)[0];
      const last = cl[cl.length - 1];
      out.push({ key: ref.key, label: last.label, amount: Math.abs(last.amount), type: last.amount > 0 ? 'revenu' : 'depense', day, start: cl[0].date.slice(0, 7), months: months.size, idx: cl.map(x => x.i) });
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}
