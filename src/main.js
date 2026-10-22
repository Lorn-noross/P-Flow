import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';

import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut, GoogleAuthProvider, signInWithPopup, signInWithCredential, reload,
} from 'firebase/auth';
import {
  collection, doc, query, where, onSnapshot, setDoc, addDoc, deleteDoc, getDoc, getDocFromServer, getDocsFromServer, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth, db, isNative } from './firebase.js';
import * as Drive from './drive.js';

// Module natif de P-Flow (Android) : Drive, Enregistrer sous, mises à jour, couleur des barres système.
const PFlowNative = registerPlugin('PFlowNative');

/* global __APP_VERSION__, __APP_BUILD__, __PAGES_URL__, __NOTES__, __NOTES_VERSION__ */
const RAW_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const APP_VERSION = RAW_VERSION.replace(/-beta/, ' bêta').replace(/-test(\d+)$/, ' (test $1)');
const APP_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '0';
const PAGES_URL = typeof __PAGES_URL__ !== 'undefined' ? __PAGES_URL__ : '';
// Nouveautés de la version (notes-de-version/<version>.md, intégrées à la construction : vite.config.js).
const NOTES = typeof __NOTES__ !== 'undefined' ? __NOTES__ : '';
const NOTES_VERSION = typeof __NOTES_VERSION__ !== 'undefined' ? __NOTES_VERSION__ : '';
// Version du format des données que cette appli sait lire et écrire (CLAUDE.md, règle n°1).
// Champ `dataVersion` de meta/settings, absent = 1. Ne monter qu'avec une conversion validée.
// Le patch 2 n'en a pas besoin : l'épargne et les fixes non mensuels sont dans de NOUVELLES collections
// (epargne, periodiques) que les anciennes versions ignorent, et les nouveaux réglages sont facultatifs.
const DATA_VERSION = 1;

/* ---------- outils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => { const v = Math.round((Number(n) || 0) * 100) / 100; return Object.is(v, -0) ? 0 : v; };
const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const EUR0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const eur = n => EUR.format(r2(n));
const eur0 = n => EUR0.format(Math.round(n) || 0);
const NUM0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const n0 = n => (n < -0.5 ? MINUS : '') + NUM0.format(Math.abs(Math.round(n)) || 0);
const pctf = n => NUM.format(n) + ' %';
const MINUS = '−';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MI = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const VIEWS = ['mois', 'fixes', 'annee', 'reglages'];
const SUBS = { compte: 'Mon compte', pro: 'Auto-entrepreneur', apparence: 'Apparence', donnees: 'Mes données', partage: 'Partager P-Flow', admin: 'Administration', apropos: 'À propos' };
// Couleurs personnalisables : clé (variable CSS --c-<clé>), libellé, réservée au profil auto-entrepreneur.
const COLORS = [['brut', 'Revenus bruts', true], ['urssaf', 'URSSAF', true], ['net', 'Revenus nets', false], ['dep', 'Dépenses', false], ['reste', 'Reste', false]];
const PRESETS = [['#2453c4', 'Bleu'], ['#7da3ff', 'Bleu clair'], ['#0e9aa7', 'Turquoise'], ['#16845a', 'Vert'], ['#4dc48b', 'Vert clair'], ['#c2810c', 'Ambre'],
  ['#e4a940', 'Jaune'], ['#e0662e', 'Orange'], ['#c23b35', 'Rouge'], ['#d9488f', 'Rose'], ['#7a5af8', 'Violet'], ['#6a7d90', 'Gris']];
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
// Fréquences des copies automatiques sur Google Drive (en jours).
const BK_FREQ = { hebdomadaire: 7, mensuelle: 30, annuelle: 365 };
// Fixes : fréquence → nombre de mois entre deux échéances (collection `periodiques`, patch 2).
const FREQ = { mois: 1, trimestre: 3, annee: 12 };
const FREQ_LABEL = { mois: 'chaque mois', trimestre: 'chaque trimestre', annee: 'chaque année' };
const FREQ_UNIT = { mois: '/mois', trimestre: '/trim.', annee: '/an' };
const PER_TYPES = ['depense', 'revenu', 'epargne'];
// Épargne (collection `epargne`) : champ `op` (jamais « kind », réservé à l'affichage et retiré par plain()).
const OPS = ['depot', 'retrait', 'solde'];
const pad = n => String(n).padStart(2, '0');
const NOW = new Date();
const CUR = NOW.getFullYear() + '-' + pad(NOW.getMonth() + 1);
const TODAY = CUR + '-' + pad(NOW.getDate());
const ym = (y, m) => y + '-' + pad(m);
const pYM = s => { const a = s.split('-'); return { y: +a[0], m: +a[1] }; };
const addM = (s, k) => { let { y, m } = pYM(s); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return ym(y, m); };
const mDiff = (a, b) => { const A = pYM(a), B = pYM(b); return (B.y - A.y) * 12 + (B.m - A.m); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const mLabel = s => { const { y, m } = pYM(s); return MONTHS[m - 1] + ' ' + y; };
const mShort = s => { const { y, m } = pYM(s); return MS[m - 1] + ' ' + y; };
const dLabel = d => { const p = d.split('-'); return (+p[2]) + ' ' + MS[+p[1] - 1]; };
// « de mars », mais « d'avril », « d'août », « d'octobre ».
const deMois = i => (/^[aeiouyàâéèêîôû]/i.test(MONTHS[i]) ? 'd\'' : 'de ') + MONTHS[i];
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };
const sumOf = arr => r2(arr.reduce((a, i) => a + (Number(i.amount) || 0), 0));
const plural = (n, w) => n + ' ' + w + (n > 1 ? 's' : '');
const joinFr = parts => parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ' et ' + parts[parts.length - 1];
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/, YM_RE = /^\d{4}-\d{2}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseAmount(s) {
  s = String(s == null ? '' : s).replace(/[\s\u00a0\u202f€%]/g, '').replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return r2(parseFloat(s));
}
const amountStr = v => NUM.format(v).replace(/[\s\u00a0\u202f]/g, '');

if (isNative) document.body.classList.add('native');

/* ---------- apparence (propre à chaque appareil) ---------- */
// pf-theme : auto | clair | sombre ; pf-noir : 1 ; pf-texte : grand ; pf-effets : reduits.
// Même logique que le petit script en tête de index.html (appliqué avant le premier affichage).
const APP = {
  theme: ['clair', 'sombre'].includes(lsGet('pf-theme')) ? lsGet('pf-theme') : 'auto',
  noir: lsGet('pf-noir') === '1',
  texte: lsGet('pf-texte') === 'grand' ? 'grand' : 'normal',
  // Sans choix de la personne : effets réduits d'office sur les téléphones à 2 Go de mémoire ou moins.
  effets: lsGet('pf-effets') === 'reduits' || (!lsGet('pf-effets') && navigator.deviceMemory && navigator.deviceMemory <= 2) ? 'reduits' : 'normal',
};
const mq = q => (window.matchMedia ? window.matchMedia(q) : { matches: false });
const mqDark = mq('(prefers-color-scheme: dark)'), mqReduce = mq('(prefers-reduced-motion: reduce)');
const onMq = (m, fn) => { if (m.addEventListener) m.addEventListener('change', fn); else if (m.addListener) m.addListener(fn); };
const isDark = () => APP.theme === 'sombre' || (APP.theme !== 'clair' && mqDark.matches);
const motionOK = () => !mqReduce.matches && APP.effets !== 'reduits';
let lastBars = '';
function applyAppearance() {
  const d = document.documentElement, dark = isDark();
  d.setAttribute('data-scheme', dark ? 'dark' : 'light');
  if (APP.noir) d.setAttribute('data-noir', ''); else d.removeAttribute('data-noir');
  if (APP.texte === 'grand') d.setAttribute('data-texte', 'grand'); else d.removeAttribute('data-texte');
  if (APP.effets === 'reduits') d.setAttribute('data-effets', 'reduits'); else d.removeAttribute('data-effets');
  const top = getComputedStyle(d).getPropertyValue('--bg-top').trim() || (dark ? '#111A2B' : '#E2E9F8');
  const meta = $('#meta-theme'); if (meta) meta.setAttribute('content', top);
  // Android : barres du système (heure, batterie) assorties au thème choisi dans l'appli.
  const bars = top + (dark ? 'd' : 'l');
  if (isNative && bars !== lastBars) {
    lastBars = bars;
    try { PFlowNative.setSystemBars({ color: top, light: !dark }).catch(() => {}); } catch (e) { /* ancienne appli native */ }
  }
  lastChartW = 0;
  if (S.ready) { renderChart(); requestAnimationFrame(() => positionIndicator(false)); }
}
function setAppearance(k, v) {
  APP[k] = v;
  if (k === 'theme') lsSet('pf-theme', v);
  else if (k === 'noir') lsSet('pf-noir', v ? '1' : '0');
  else if (k === 'texte') lsSet('pf-texte', v);
  else if (k === 'effets') lsSet('pf-effets', v);
  applyAppearance();
  if (S.ready) renderReglages();
}
onMq(mqDark, () => applyAppearance());

/* ---------- animations ---------- */
// Toujours sur transform / opacity (gérées par la carte graphique, sans recalcul de la page).
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const SPRING = 'cubic-bezier(.2,1.18,.32,1)'; // léger dépassement, effet « liquide »
function anim(el, frames, opts) {
  if (!el || !el.animate || !motionOK()) return null;
  try { return el.animate(frames, opts); } catch (e) { return null; }
}
const slideIn = (el, dir, dist) => anim(el, [{ transform: 'translateX(' + (dir * (dist || 28)) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: SPRING });
const riseIn = el => anim(el, [{ transform: 'translateY(10px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE });

/* ---------- écrans ---------- */
const SCREENS = ['s-boot', 's-login', 's-verify', 's-denied', 's-onboard', 'app'];
function show(id) { SCREENS.forEach(s => { $('#' + s).hidden = s !== id; }); }

/* ---------- état ---------- */
const S = {
  user: null, isAdmin: false, ready: false,
  view: 'mois', month: CUR, year: NOW.getFullYear(), sub: null,
  entries: [], entriesYear: null, unsubEntries: null,
  recurring: [], periodiques: [], epargne: [], demandes: [],
  settings: null, settingsExists: false, readOnly: false,
  loaded: { entries: false, recurring: false, settings: false, periodiques: false, epargne: false },
  pend: { entries: false, recurring: false, settings: false, periodiques: false, epargne: false },
  showFixed: lsGet('pf-showFixed') === '1', grouped: lsGet('pf-groupe') === '1', openGroups: new Set(),
  showEnded: false, colorOpen: null, ucOpen: false, simOpen: false, bubble: null,
  unsubs: [], allow: [], justOnboarded: false,
};
{ const h = (location.hash || '').slice(1); if (VIEWS.includes(h)) S.view = h; }

const ready = () => Object.values(S.loaded).every(Boolean);
const isPro = () => !!(S.settings && S.settings.pro);
const uref = (...p) => doc(db, 'users', S.user.uid, ...p);
const ucol = name => collection(db, 'users', S.user.uid, name);

function normSettings(d) {
  d = d || {};
  const taux = {};
  if (d.taux && typeof d.taux === 'object') for (const k of Object.keys(d.taux)) { const v = Number(d.taux[k]); if (isFinite(v)) taux[k] = v; }
  // Champ facultatif `couleurs` (absent dans les données d'avant le patch 1) : null ou absent = couleur par défaut.
  const couleurs = {};
  if (d.couleurs && typeof d.couleurs === 'object') for (const [k] of COLORS) if (isHex(d.couleurs[k])) couleurs[k] = d.couleurs[k].toLowerCase();
  // Champ facultatif `sauvegarde` (patch 1) : copies automatiques sur Google Drive.
  const sv = d.sauvegarde && typeof d.sauvegarde === 'object' ? d.sauvegarde : {};
  const sauvegarde = { drive: sv.drive === true, frequence: BK_FREQ[sv.frequence] ? sv.frequence : 'mensuelle', derniere: Number(sv.derniere) || 0 };
  // Champ facultatif `epargne` (patch 2) : true = suivie, false = refusée, absent = pas encore choisi.
  const epargne = d.epargne === true ? true : d.epargne === false ? false : null;
  return { pro: !!d.pro, taux, periodicite: d.periodicite === 'trimestrielle' ? 'trimestrielle' : 'mensuelle', couleurs, sauvegarde, epargne };
}
// Épargne affichée et comptée : choisie dans Réglages, ou des données d'épargne existent déjà (choix pas encore fait).
function epOn() {
  if (!S.settings) return false;
  if (S.settings.epargne === true) return true;
  if (S.settings.epargne === false) return false;
  return S.epargne.length > 0 || S.periodiques.some(p => p.type === 'epargne');
}
// Applique les couleurs du compte (les mêmes sur tous les appareils).
function applyColors() {
  const c = (S.settings && S.settings.couleurs) || {}, st = document.documentElement.style;
  for (const [k] of COLORS) { if (c[k]) st.setProperty('--c-' + k, c[k]); else st.removeProperty('--c-' + k); }
}
function rateFor(y) {
  if (!isPro()) return 0;
  const t = S.settings.taux || {};
  if (t[y] != null) return t[y];
  const ks = Object.keys(t).map(Number).sort((a, b) => a - b);
  const before = ks.filter(k => k < y);
  if (before.length) return t[before[before.length - 1]];
  if (ks.length) return t[ks[0]];
  return 0;
}

/* ---------- calculs ---------- */
// Fixes trimestriels / annuels : comptés en entier le mois où ils tombent, à partir du mois de départ.
const perStep = p => FREQ[p.freq] || 0;
function perDue(p, m) {
  const st = perStep(p);
  if (!st || !p.start || !YM_RE.test(p.start) || p.start > m || (p.end && p.end < m)) return false;
  return mDiff(p.start, m) % st === 0;
}
// Première échéance à partir du mois `from` (null si le fixe est terminé avant).
function perNext(p, from) {
  const st = perStep(p); if (!st || !p.start) return null;
  const m = firstDue(p.start, p.freq, from);
  return p.end && m > p.end ? null : m;
}
// Premier mois ≥ from dans le cycle qui commence à `anchor`.
function firstDue(anchor, freq, from) {
  const st = FREQ[freq] || 1;
  if (anchor >= from) return anchor;
  return addM(anchor, Math.ceil(mDiff(anchor, from) / st) * st);
}
function monthData(m) {
  const y = pYM(m).y;
  const ents = (S.entriesYear === y ? S.entries : []).filter(e => e.month === m).map(e => Object.assign({ kind: 'entry' }, e));
  const recs = S.recurring.filter(r => r.start && r.start <= m && (!r.end || r.end >= m)).map(r => Object.assign({ kind: 'rec' }, r));
  const pers = S.periodiques.filter(p => (p.type === 'depense' || p.type === 'revenu') && perDue(p, m)).map(p => Object.assign({ kind: 'per' }, p));
  const items = ents.concat(recs, pers);
  const rate = rateFor(y);
  let brut = 0, base = 0, dep = 0;
  for (const it of items) {
    const a = Number(it.amount) || 0;
    if (it.type === 'revenu') { brut += a; if (it.urssaf && isPro()) base += a; } else dep += a;
  }
  brut = r2(brut); base = r2(base); dep = r2(dep);
  const urssaf = r2(base * rate / 100);
  const net = r2(brut - urssaf);
  // Épargne : dépôts (et versements automatiques) baissent le reste, les retraits le remontent.
  const on = epOn();
  const eps = on ? S.epargne.filter(e => e.month === m && (e.op === 'depot' || e.op === 'retrait')).map(e => Object.assign({ kind: 'ep' }, e)) : [];
  const autos = on ? S.periodiques.filter(p => p.type === 'epargne' && perDue(p, m)).map(p => Object.assign({ kind: 'auto' }, p)) : [];
  let epIn = 0, epOut = 0;
  for (const e of eps) { const a = Number(e.amount) || 0; if (e.op === 'retrait') epOut += a; else epIn += a; }
  for (const p of autos) epIn += Number(p.amount) || 0;
  epIn = r2(epIn); epOut = r2(epOut);
  const ep = r2(epIn - epOut);
  return { m, items, ents, recs, pers, eps, autos, rate, brut, base, urssaf, net, dep, epIn, epOut, ep, reste: r2(net - dep - ep) };
}
// Comptes d'épargne : solde = dernier « J'ai actuellement » + dépôts − retraits notés depuis (versements automatiques compris).
function comptes() {
  const map = new Map();
  const get = l => { const k = norm(l); let c = map.get(k); if (!c) { c = { key: k, label: String(l).trim(), ev: [], autos: [] }; map.set(k, c); } return c; };
  for (const e of S.epargne) if (e.label && DATE_RE.test(e.date || '') && OPS.includes(e.op)) get(e.label).ev.push({ d: e.date, t: Number(e.createdAt) || 0, op: e.op, a: Number(e.amount) || 0 });
  for (const p of S.periodiques) {
    if (p.type !== 'epargne' || !p.label || !perStep(p) || !YM_RE.test(p.start || '')) continue;
    const c = get(p.label); c.autos.push(p);
    for (let m = p.start, i = 0; m <= CUR && i < 1200; m = addM(m, perStep(p)), i++) {
      if (p.end && m > p.end) break;
      c.ev.push({ d: m + '-01', t: -1, op: 'depot', a: Number(p.amount) || 0 });
    }
  }
  const out = [];
  for (const c of map.values()) {
    c.ev.sort((a, b) => a.d.localeCompare(b.d) || a.t - b.t);
    let bal = 0;
    for (const e of c.ev) { if (e.op === 'solde') bal = e.a; else if (e.op === 'retrait') bal -= e.a; else bal += e.a; }
    out.push({ key: c.key, label: c.label, solde: r2(bal), autos: c.autos.filter(p => !p.end || p.end >= CUR) });
  }
  return out.sort((a, b) => b.solde - a.solde || a.label.localeCompare(b.label));
}
function urssafPeriod(m) {
  const { y, m: mm } = pYM(m);
  if (S.settings.periodicite === 'trimestrielle') {
    const q = Math.floor((mm - 1) / 3);
    let total = 0, base = 0;
    for (const x of [1, 2, 3].map(k => ym(y, q * 3 + k))) { const d = monthData(x); total += d.urssaf; base += d.base; }
    const dl = [new Date(y, 3, 30), new Date(y, 6, 31), new Date(y, 9, 31), new Date(y + 1, 0, 31)][q];
    return { title: 'URSSAF du ' + ['1er', '2e', '3e', '4e'][q] + ' trimestre', sub: MS[q * 3] + ' → ' + MS[q * 3 + 2], total: r2(total), base: r2(base), dl };
  }
  const d = monthData(m);
  return { title: 'URSSAF ' + deMois(mm - 1), sub: '', total: d.urssaf, base: d.base, dl: new Date(y, mm + 1, 0), rate: d.rate };
}

/* ---------- authentification ---------- */
let loginMode = 'login';
function setLoginMode(m) {
  loginMode = m;
  $('#l-error').textContent = ''; $('#l-info').hidden = true;
  $('#login-title').textContent = m === 'signup' ? 'Créer un compte' : m === 'reset' ? 'Mot de passe oublié' : 'Connexion';
  $('#l-pass-field').hidden = m === 'reset';
  $('#l-pass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('#l-submit').textContent = m === 'signup' ? 'Créer mon compte' : m === 'reset' ? 'Envoyer le lien' : 'Se connecter';
  $('#l-switch').textContent = m === 'login' ? 'Créer un compte' : 'J\'ai déjà un compte';
  $('#l-forgot').hidden = m !== 'login';
}
function authErr(e) {
  const c = (e && e.code) || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Email ou mot de passe incorrect.';
  if (c.includes('email-already-in-use')) return 'Un compte existe déjà avec cet email. Connecte-toi.';
  if (c.includes('weak-password')) return 'Mot de passe trop court : 6 caractères minimum.';
  if (c.includes('invalid-email')) return 'Cet email n\'est pas valide.';
  if (c.includes('too-many-requests')) return 'Trop d\'essais. Patiente quelques minutes.';
  if (c.includes('network')) return 'Pas de connexion internet.';
  if (c.includes('popup-closed') || c.includes('cancelled-popup')) return '';
  if (c.includes('popup-blocked')) return 'Le navigateur a bloqué la fenêtre Google. Autorise les pop-ups pour ce site.';
  return 'Ça n\'a pas marché (' + (c || 'erreur inconnue') + ').';
}
$('#l-switch').addEventListener('click', () => setLoginMode(loginMode === 'login' ? 'signup' : 'login'));
$('#l-forgot').addEventListener('click', () => setLoginMode('reset'));
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#l-email').value.trim(), pass = $('#l-pass').value;
  const err = $('#l-error'); err.textContent = '';
  if (!email) { err.textContent = 'Indique ton email.'; return; }
  const btn = $('#l-submit'); btn.disabled = true;
  try {
    if (loginMode === 'reset') {
      await sendPasswordResetEmail(auth, email);
      setLoginMode('login');
      const i = $('#l-info'); i.hidden = false; i.textContent = 'Si un compte existe, un lien de réinitialisation vient d\'être envoyé à ' + email + '.';
    } else if (loginMode === 'signup') {
      if (pass.length < 6) { err.textContent = 'Mot de passe trop court : 6 caractères minimum.'; return; }
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      try { await sendEmailVerification(cred.user); } catch (x) { /* renvoi possible ensuite */ }
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (x) { err.textContent = authErr(x); }
  finally { btn.disabled = false; }
});
// Connexion Google.
// Android : module natif (méthode 1 = sélecteur moderne, méthode 2 = sélecteur classique),
// puis le jeton est transmis au SDK web Firebase. Chaque étape est affichée à l'écran.
let gAttempt = 0;
async function nativeGoogle(useCM) {
  const st = $('#g-status'), alt = $('#g-alt'), err = $('#l-error');
  const id = ++gAttempt;
  err.textContent = '';
  st.hidden = false; st.className = 'notice';
  st.textContent = useCM ? 'Ouverture de Google…' : 'Ouverture du sélecteur de compte Google…';
  alt.hidden = true;
  const timer = setTimeout(() => {
    if (id !== gAttempt) return;
    st.textContent = 'Google ne répond pas.';
    alt.dataset.cm = useCM ? '0' : '1'; alt.hidden = false;
  }, 12000);
  try {
    const r = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: useCM });
    clearTimeout(timer);
    const idToken = r && r.credential && r.credential.idToken;
    if (!idToken) throw new Error('Google n\'a pas renvoyé de jeton.');
    st.textContent = 'Compte Google reçu, connexion à P-Flow…';
    await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    st.hidden = true; alt.hidden = true;
  } catch (x) {
    clearTimeout(timer);
    if (id !== gAttempt) return;
    const code = x && x.code ? String(x.code) : '';
    const msg = code.startsWith('auth/') ? authErr(x) : ((x && x.message) || code || 'erreur inconnue');
    st.className = 'notice err';
    st.textContent = 'La connexion Google n\'a pas abouti : ' + msg;
    alt.dataset.cm = useCM ? '0' : '1'; alt.hidden = false;
  }
}
$('#google-btn').addEventListener('click', async () => {
  $('#l-error').textContent = '';
  // Sur Android, le sélecteur de compte classique est le plus fiable : on commence par lui.
  if (isNative) { nativeGoogle(false); return; }
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (x) {
    const code = x && x.code ? String(x.code) : '';
    if (/popup-closed|cancelled-popup/.test(code)) return;
    $('#l-error').textContent = authErr(x);
  }
});
$('#g-alt').addEventListener('click', e => nativeGoogle(e.currentTarget.dataset.cm === '1'));
$('#login-version').textContent = 'P-Flow ' + APP_VERSION;
// Toute erreur imprévue s'affiche sur l'écran de connexion au lieu de rester invisible.
function showDiag(m) { if (!$('#s-login').hidden) { const e = $('#l-error'); e.textContent = 'Erreur : ' + m; } }
window.addEventListener('error', e => showDiag(e.message || 'inconnue'));
window.addEventListener('unhandledrejection', e => showDiag((e.reason && (e.reason.message || e.reason.code)) || String(e.reason)));
$('#v-resend').addEventListener('click', async () => {
  try { await sendEmailVerification(auth.currentUser); $('#v-error').textContent = 'Email renvoyé.'; }
  catch (x) { $('#v-error').textContent = authErr(x); }
});
$('#v-done').addEventListener('click', async () => {
  const u = auth.currentUser; if (!u) return;
  try { await reload(u); } catch (x) { /* hors ligne */ }
  if (u.emailVerified) { await u.getIdToken(true); routeUser(u); }
  else $('#v-error').textContent = 'L\'email n\'est pas encore vérifié. Ouvre le lien reçu, puis réessaie.';
});
$('#d-retry').addEventListener('click', () => { if (auth.currentUser) routeUser(auth.currentUser); });

async function logout() {
  stopData(); stopReq();
  if (isNative) { try { await FirebaseAuthentication.signOut(); } catch (e) { /* pas de session Google native */ } }
  try { await signOut(auth); } catch (e) { /* déjà déconnecté */ }
}

onAuthStateChanged(auth, user => {
  if (!user) { stopData(); stopReq(); S.user = null; setLoginMode('login'); show('s-login'); return; }
  routeUser(user);
});

async function routeUser(user) {
  S.user = user;
  stopReq();
  const pwd = user.providerData.some(p => p.providerId === 'password');
  if (pwd && !user.emailVerified) { $('#v-email').textContent = user.email; $('#v-error').textContent = ''; show('s-verify'); return; }
  const email = (user.email || '').toLowerCase();
  const flag = 'pf-allowed-' + user.uid;
  let allowed = false;
  $('#d-error').textContent = '';
  try {
    const snap = await getDoc(doc(db, 'allowlist', email));
    allowed = snap.exists();
  } catch (e) {
    if (e && e.code === 'unavailable' && lsGet(flag) === '1') allowed = true;
    else if (e && e.code === 'unavailable') $('#d-error').textContent = 'Pas de connexion internet. Réessaie une fois connecté.';
  }
  if (S.user !== user) return; // changement de compte pendant la vérification
  if (!allowed) { enterDenied(user, email); return; }
  lsSet(flag, '1');
  try { S.isAdmin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch (e) { S.isAdmin = lsGet('pf-admin-' + user.uid) === '1'; }
  lsSet('pf-admin-' + user.uid, S.isAdmin ? '1' : '0');
  startData();
}

/* ---------- demande d'accès (compte pas encore autorisé) ---------- */
// La personne est connectée (son adresse est donc prouvée) : elle enregistre une demande dans
// `demandes/{son email}` ; l'administrateur la voit dans l'appli et l'accepte (ajout à `allowlist`) ou la refuse.
// Dès que l'accès est accordé, l'appli s'ouvre toute seule.
const REQ = { unsubs: [], sent: null, busy: false };
function stopReq() { REQ.unsubs.forEach(u => { try { u(); } catch (e) { /* ignoré */ } }); REQ.unsubs = []; REQ.sent = null; REQ.busy = false; }
const tsMs = v => (v && typeof v.toMillis === 'function' ? v.toMillis() : Number(v) || 0);
const dateFr = ms => { const d = new Date(ms); return isNaN(d) || !ms ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
function enterDenied(user, email) {
  $('#d-email').textContent = user.email || ''; $('#d-uid').textContent = user.uid; $('#d-mail').textContent = email;
  REQ.sent = null; renderReq('');
  show('s-denied');
  getDoc(doc(db, 'demandes', email)).then(s => { if (S.user === user && s.exists()) { REQ.sent = s.data(); renderReq(''); } }, () => {});
  try {
    REQ.unsubs.push(onSnapshot(doc(db, 'allowlist', email), snap => {
      if (snap.exists() && S.user === user && !$('#s-denied').hidden) { stopReq(); routeUser(user); }
    }, () => {}));
  } catch (e) { /* « Réessayer » reste possible */ }
}
function renderReq(msg, kind) {
  const sent = !!REQ.sent, btn = $('#req-send');
  const when = sent ? dateFr(tsMs(REQ.sent.at)) : '';
  $('#req-intro').textContent = sent
    ? 'Ta demande est envoyée' + (when ? ' (le ' + when + ')' : '') + '. Dès qu\'elle sera acceptée, P-Flow s\'ouvrira tout seul ici.'
    : 'Demande l\'accès : la personne qui gère P-Flow recevra ta demande dans l\'appli et pourra l\'accepter.';
  $('#req-msg-field').hidden = sent;
  btn.textContent = sent ? 'Renvoyer la demande' : 'Demander l\'accès';
  btn.className = 'btn block ' + (sent ? 'ghost' : 'primary');
  btn.disabled = REQ.busy;
  const st = $('#req-status');
  st.textContent = msg || ''; st.hidden = !msg; st.className = 'notice' + (kind ? ' ' + kind : '');
}
$('#req-send').addEventListener('click', async () => {
  const u = auth.currentUser; if (!u || REQ.busy) return;
  const email = (u.email || '').toLowerCase();
  const message = $('#req-msg').value.trim().replace(/\s+/g, ' ').slice(0, 200);
  const data = { uid: u.uid, message: REQ.sent && !message ? String(REQ.sent.message || '').slice(0, 200) : message, nom: String(u.displayName || '').slice(0, 100), at: serverTimestamp() };
  REQ.busy = true; renderReq('Envoi de la demande…');
  let timer;
  try {
    await Promise.race([setDoc(doc(db, 'demandes', email), data), new Promise((res, rej) => { timer = setTimeout(() => rej({ code: 'timeout' }), 12000); })]);
    REQ.sent = { message: data.message, at: Date.now() };
    REQ.busy = false; renderReq('Demande envoyée.', 'ok');
  } catch (e) {
    REQ.busy = false;
    const c = (e && e.code) || '';
    renderReq(c === 'timeout' ? 'Pas de connexion internet : la demande partira dès que tu seras connecté.'
      : c === 'permission-denied' ? 'La demande n\'a pas pu être envoyée. Demande directement à la personne qui t\'a donné P-Flow de t\'ajouter.'
        : 'La demande n\'a pas pu être envoyée (' + (c || 'erreur') + '). Réessaie dans un moment.', 'err');
  } finally { clearTimeout(timer); }
});

/* ---------- données ---------- */
function stopData() {
  S.unsubs.forEach(u => { try { u(); } catch (e) { /* ignoré */ } });
  S.unsubs = [];
  if (S.unsubEntries) { try { S.unsubEntries(); } catch (e) { /* ignoré */ } }
  S.unsubEntries = null; S.entriesYear = null; S.entries = []; S.recurring = []; S.periodiques = []; S.epargne = []; S.demandes = [];
  S.settings = null; S.allow = []; S.sub = null; S.justOnboarded = false; S.bubble = null;
  S.readOnly = false; S.settingsServer = false; $('#outdated').hidden = true; applyColors();
  resetBackupState();
  S.loaded = { entries: false, recurring: false, settings: false, periodiques: false, epargne: false };
  S.ready = false;
}
function startData() {
  stopData();
  const opts = { includeMetadataChanges: true };
  S.unsubs.push(onSnapshot(uref('meta', 'settings'), opts, snap => {
    S.pend.settings = snap.metadata.hasPendingWrites;
    if (!snap.exists() && snap.metadata.fromCache) return; // attendre la réponse du serveur
    S.settingsExists = snap.exists();
    S.settings = normSettings(snap.exists() ? snap.data() : null);
    // Données écrites par une version plus récente : lecture seule, pour ne rien abîmer.
    S.readOnly = (snap.exists() && Number(snap.data().dataVersion) || 1) > DATA_VERSION;
    $('#outdated').hidden = !S.readOnly;
    applyColors();
    S.loaded.settings = true;
    document.body.classList.toggle('pro', isPro());
    if (!S.settingsExists) { openOnboarding(false); return; }
    enterApp();
    // Copie Drive automatique : seulement sur des réglages confirmés par le serveur (date de la dernière copie à jour).
    if (!snap.metadata.fromCache) { S.settingsServer = true; maybeAutoBackup(); }
  }, dbError));
  const sub = (name, key) => S.unsubs.push(onSnapshot(ucol(name), opts, snap => {
    S[key] = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    S.pend[key] = snap.metadata.hasPendingWrites;
    S.loaded[key] = true; render();
  }, dbError));
  sub('recurring', 'recurring');
  // Patch 2 : nouvelles collections (déjà couvertes par les règles users/{uid}/…), ignorées par les anciennes versions.
  sub('periodiques', 'periodiques');
  sub('epargne', 'epargne');
  if (S.isAdmin) {
    S.unsubs.push(onSnapshot(collection(db, 'allowlist'), snap => {
      S.allow = snap.docs.map(d => d.id).sort(); renderAllow();
    }, () => {}));
    // Demandes d'accès (règles Firestore du patch 2 ; sans elles, la liste reste simplement vide).
    S.unsubs.push(onSnapshot(collection(db, 'demandes'), snap => {
      S.demandes = snap.docs.map(d => Object.assign({ email: d.id }, d.data())).sort((a, b) => tsMs(a.at) - tsMs(b.at));
      render();
    }, () => {}));
  }
  ensureYearSub();
}
function enterApp() {
  if (!S.ready) {
    S.ready = true;
    if ($('#s-onboard').hidden || !OB.redo) show('app');
    maybeAutoUpdate();
    requestAnimationFrame(() => positionIndicator(false));
    setTimeout(maybeNews, 700);
  }
  render();
}
function neededYear() { return S.view === 'mois' ? pYM(S.month).y : S.year; }
function ensureYearSub() {
  if (!S.user) return;
  const y = neededYear();
  if (S.entriesYear === y && S.unsubEntries) return;
  if (S.unsubEntries) { try { S.unsubEntries(); } catch (e) { /* ignoré */ } }
  S.entriesYear = y; S.entries = []; S.loaded.entries = false;
  const q = query(ucol('entries'), where('month', '>=', y + '-01'), where('month', '<=', y + '-12'));
  S.unsubEntries = onSnapshot(q, { includeMetadataChanges: true }, snap => {
    if (S.entriesYear !== y) return;
    S.entries = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    S.pend.entries = snap.metadata.hasPendingWrites;
    S.loaded.entries = true; render();
  }, dbError);
}
function dbError(e) {
  if (e && e.code === 'permission-denied') { toast('Accès refusé par le serveur. Reconnecte-toi.', true); }
  else toast('Problème de synchronisation : ' + ((e && e.code) || 'inconnu'), true);
}
function errText(e) {
  const c = (e && e.code) || '';
  if (c === 'permission-denied') return 'Enregistrement refusé : accès non autorisé.';
  if (c === 'resource-exhausted') return 'Limite du serveur atteinte. Réessaie plus tard.';
  return 'Pas enregistré (' + (c || 'erreur') + ').';
}
// Lecture seule (données d'une version plus récente) : toute modification est refusée.
function blocked() {
  if (!S.readOnly) return false;
  toast('Mets P-Flow à jour pour pouvoir modifier tes données.', true);
  return true;
}
// Écriture « optimiste » : enregistrée tout de suite sur l'appareil, envoyée dès que le réseau est là.
function write(p, okMsg) {
  Promise.resolve(p).catch(e => toast(errText(e), true));
  if (okMsg) toast(okMsg);
  updateSync();
}
const plain = o => { const c = Object.assign({}, o); delete c.id; delete c.kind; return c; };

/* ---------- premier démarrage guidé ---------- */
// 6 étapes, toutes facultatives (« Passer »). Écrit exactement les mêmes documents qu'un ajout manuel.
// Nouveau compte (meta/settings absent) : tout est écrit à la fin. « Refaire la configuration » (Réglages) :
// rien n'est supprimé, on ajoute seulement ce qui est saisi, et les réglages sont fusionnés.
const OB_STEPS = ['profil', 'revenus', 'charges', 'epargne', 'apparence', 'sauvegarde'];
const OB_QUICK = {
  rev: ['Salaire', 'Aides (CAF…)', 'Pension', 'Loyer perçu'],
  dep: ['Loyer', 'Électricité', 'Internet', 'Téléphone', 'Assurance', 'Crédit', 'Abonnements'],
  ep: ['Livret A', 'LDDS', 'PEL', 'Assurance vie'],
};
const OB = { step: 0, redo: false, pro: false, rate: '', period: 'mensuelle', rev: [], dep: [], ep: null, comptes: [], drive: false, driveMsg: '', busy: false };
function openOnboarding(redo) {
  if (!redo && !$('#s-onboard').hidden && !OB.redo) return; // déjà ouvert : ne pas recommencer
  Object.assign(OB, { step: 0, redo, rev: [], dep: [], comptes: [], drive: false, driveMsg: '', busy: false,
    pro: redo ? isPro() : false, rate: redo && isPro() ? amountStr(rateFor(NOW.getFullYear())) : '',
    period: redo ? S.settings.periodicite : 'mensuelle', ep: redo ? (S.settings.epargne === null ? null : epOn()) : null });
  $('#o-error').textContent = '';
  show('s-onboard');
  obRender(0);
  window.scrollTo(0, 0);
}
function monthOptions(sel, around) {
  const lo = addM(around.reduce((a, b) => (a < b ? a : b)), -24), hi = addM(around.reduce((a, b) => (a > b ? a : b)), 24);
  let h = '';
  for (let m = lo; m <= hi; m = addM(m, 1)) h += '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + cap(mLabel(m)) + '</option>';
  return h;
}
function obRowHtml(kind, r, i) {
  const ep = kind === 'ep';
  const freq = f => '<select class="input" data-f="freq" aria-label="Fréquence">' + Object.keys(FREQ).map(k => '<option value="' + k + '"' + (r.freq === k ? ' selected' : '') + '>' + cap(FREQ_LABEL[k]) + '</option>').join('') + '</select>';
  return '<div class="ob-row" data-kind="' + kind + '" data-i="' + i + '">' +
    '<input class="input" data-f="label" value="' + esc(r.label) + '" maxlength="80" placeholder="' + (ep ? 'Nom du compte' : 'À quoi ça correspond') + '" aria-label="' + (ep ? 'Nom du compte' : 'Libellé') + '">' +
    '<input class="input amt" data-f="amount" value="' + esc(r.amount) + '" inputmode="decimal" placeholder="' + (ep ? 'Solde' : '0') + ' €" aria-label="' + (ep ? 'Solde actuel' : 'Montant') + '" autocomplete="off">' +
    '<button type="button" class="icon-btn" data-ob="del" aria-label="Retirer">' + ico('close') + '</button>' +
    (ep
      ? '<div class="more"><label>Versement automatique (facultatif)<input class="input amt" data-f="auto" value="' + esc(r.auto) + '" inputmode="decimal" placeholder="0 €" autocomplete="off"></label><label>Fréquence' + freq() + '</label></div>'
      : '<div class="more"><label>Revient' + freq() + '</label><label>À partir de<select class="input" data-f="start">' + monthOptions(r.start, [CUR]) + '</select></label></div>') +
    '</div>';
}
function existingFixes(type) {
  const xs = S.recurring.filter(r => (type === 'revenu' ? r.type === 'revenu' : r.type !== 'revenu') && (!r.end || r.end >= CUR)).map(r => Object.assign({ freq: 'mois' }, r))
    .concat(S.periodiques.filter(p => p.type === type && perStep(p) && (!p.end || p.end >= CUR)));
  return xs.length ? '<p class="ob-done">Déjà notés : ' + xs.map(x => esc(x.label) + ' (' + esc(eur(x.amount)) + FREQ_UNIT[x.freq] + ')').join(', ') + '.</p>' : '';
}
function obRender(dir) {
  const id = OB_STEPS[OB.step], box = $('#ob-step');
  const n = OB.step + 1, N = OB_STEPS.length;
  $('#ob-count').textContent = 'Étape ' + n + ' sur ' + N;
  $('#ob-bar').style.transform = 'scaleX(' + (n / N).toFixed(3) + ')';
  let h = '';
  if (id === 'profil') {
    h = '<h2>' + (OB.redo ? 'Ta configuration' : 'Bienvenue sur P-Flow') + '</h2><p>Quelques questions pour préparer l\'appli. Chaque étape est facultative, et tout reste modifiable ensuite.</p>' +
      '<p class="h3">Ton profil</p><div class="choice" id="o-profile">' +
      '<button type="button" data-ob="pro" data-pro="0" aria-pressed="' + !OB.pro + '"><b>Particulier</b><span>Salaire, aides, dépenses du foyer.</span></button>' +
      '<button type="button" data-ob="pro" data-pro="1" aria-pressed="' + OB.pro + '"><b>Auto-entrepreneur</b><span>Calcul automatique de la part URSSAF sur ton chiffre d\'affaires.</span></button></div>' +
      '<div class="stack" id="o-pro"' + (OB.pro ? '' : ' hidden') + '>' +
      '<label class="field"><span>Taux URSSAF (%)</span><input class="input num" id="o-rate" inputmode="decimal" placeholder="Ex. 21,2" autocomplete="off" value="' + esc(OB.rate) + '"></label>' +
      '<p class="hint">Artisan en prestations de services : 21,2 % de cotisations, + 0,3 % formation pro, + 0,48 % chambre des métiers. Ventes de marchandises : 12,3 %.</p>' +
      '<div class="seg" id="o-period"><button type="button" data-ob="period" data-p="mensuelle" aria-pressed="' + (OB.period === 'mensuelle') + '">Déclaration mensuelle</button><button type="button" data-ob="period" data-p="trimestrielle" aria-pressed="' + (OB.period === 'trimestrielle') + '">Trimestrielle</button></div></div>';
  } else if (id === 'revenus' || id === 'charges') {
    const k = id === 'revenus' ? 'rev' : 'dep', rows = OB[k];
    h = '<h2>' + (k === 'rev' ? 'Tes revenus fixes' : 'Tes charges fixes') + '</h2>' +
      '<p>' + (k === 'rev' ? 'Ce qui rentre régulièrement. Touche un bouton, puis tape le montant.' : 'Ce qui part régulièrement. Touche un bouton, puis tape juste le montant.') + ' Les boutons sont des raccourcis : le nom reste modifiable.</p>' +
      (OB.redo ? existingFixes(k === 'rev' ? 'revenu' : 'depense') : '') +
      '<div class="chips">' + OB_QUICK[k].map(l => '<button type="button" data-ob="add" data-k="' + k + '" data-l="' + esc(l) + '">' + esc(l) + '</button>').join('') +
      '<button type="button" class="add" data-ob="add" data-k="' + k + '" data-l="">+ ' + (k === 'rev' ? 'Autre revenu' : 'Autre charge') + '</button></div>' +
      '<div class="ob-rows">' + rows.map((r, i) => obRowHtml(k, r, i)).join('') + '</div>';
  } else if (id === 'epargne') {
    h = '<h2>Ton épargne</h2><p>Veux-tu suivre ce que tu mets de côté (Livret A, PEL…) ? Ce que tu épargnes est retiré du reste du mois.</p>' +
      '<div class="seg"><button type="button" data-ob="ep" data-v="1" aria-pressed="' + (OB.ep === true) + '">Oui, la suivre</button><button type="button" data-ob="ep" data-v="0" aria-pressed="' + (OB.ep === false) + '">Non merci</button></div>' +
      (OB.ep ? '<p class="hint">Ajoute tes comptes avec leur solde actuel. Un versement automatique (facultatif) sera compté tout seul.</p>' +
        '<div class="chips">' + OB_QUICK.ep.map(l => '<button type="button" data-ob="add" data-k="ep" data-l="' + esc(l) + '">' + esc(l) + '</button>').join('') +
        '<button type="button" class="add" data-ob="add" data-k="ep" data-l="">+ Autre compte</button></div>' +
        '<div class="ob-rows">' + OB.comptes.map((r, i) => obRowHtml('ep', r, i)).join('') + '</div>' : '');
  } else if (id === 'apparence') {
    h = '<h2>L\'apparence</h2><p>Réglée pour cet appareil. Tu la retrouves dans Réglages → Apparence.</p>' +
      '<p class="h3">Thème</p><div class="seg seg3">' + [['auto', 'Automatique'], ['clair', 'Clair'], ['sombre', 'Sombre']].map(([k, l]) => '<button type="button" data-ob="theme" data-t="' + k + '" aria-pressed="' + (APP.theme === k) + '">' + l + '</button>').join('') + '</div>' +
      '<label class="check"><span>Noir absolu<small>En mode sombre, fond noir pur (écrans OLED).</small></span><input type="checkbox" data-ob="noir"' + (APP.noir ? ' checked' : '') + '></label>' +
      '<p class="h3">Taille du texte</p><div class="seg">' + [['normal', 'Normale'], ['grand', 'Grande']].map(([k, l]) => '<button type="button" data-ob="texte" data-t="' + k + '" aria-pressed="' + (APP.texte === k) + '">' + l + '</button>').join('') + '</div>';
  } else {
    h = '<h2>Sauvegarde</h2><p>Tes données sont déjà enregistrées dans ton compte. Tu peux en plus garder une copie automatique dans ton Google Drive (dossier « P-Flow Sauvegardes ») : P-Flow ne voit que les fichiers qu\'il crée.</p>' +
      (OB.drive ? '<p class="notice ok">Google Drive connecté : ' + (isNative ? 'une première copie sera faite à l\'ouverture de l\'appli.' : 'à l\'ouverture de l\'appli, un bandeau te proposera la première copie (un seul toucher).') + '</p>'
        : '<div><button type="button" class="btn ghost" data-ob="drive"' + (OB.busy ? ' disabled' : '') + '>Connecter Google Drive</button></div>') +
      (OB.driveMsg ? '<p class="notice err">' + esc(OB.driveMsg) + '</p>' : '') +
      '<p class="hint">Tu peux aussi le faire plus tard dans Réglages → Mes données.</p>';
    if (!isNative) Drive.prepareWeb(S.user && S.user.email).catch(() => {});
  }
  box.innerHTML = h;
  $('#ob-back').hidden = OB.step === 0 && !OB.redo;
  $('#ob-back').textContent = OB.step === 0 ? 'Annuler' : 'Retour';
  $('#ob-skip').hidden = OB.step === N - 1;
  $('#ob-next').textContent = OB.step === N - 1 ? 'C\'est parti' : 'Continuer';
  $('#ob-next').disabled = OB.busy;
  if (dir) slideIn(box, dir, 36);
}
// Lit et vérifie les lignes d'une étape ; renvoie un message d'erreur ou ''.
function obCheckRows(k) {
  const rows = OB[k === 'ep' ? 'comptes' : k];
  for (let i = rows.length - 1; i >= 0; i--) if (!rows[i].label.trim() && !String(rows[i].amount).trim() && !String(rows[i].auto || '').trim()) rows.splice(i, 1);
  for (const r of rows) {
    if (!r.label.trim()) return k === 'ep' ? 'Donne un nom à chaque compte.' : 'Écris à quoi correspond chaque montant.';
    const a = parseAmount(r.amount);
    if (k === 'ep') {
      if (String(r.amount).trim() && !(a >= 0)) return 'Solde invalide pour « ' + r.label.trim() + ' » : écris par exemple 1 200.';
      if (String(r.auto || '').trim() && !(parseAmount(r.auto) > 0)) return 'Versement invalide pour « ' + r.label.trim() + ' ».';
      if (!String(r.amount).trim() && !String(r.auto || '').trim()) return 'Indique le solde actuel de « ' + r.label.trim() + ' » (ou retire la ligne).';
    } else if (!(a > 0)) return 'Indique le montant de « ' + r.label.trim() + ' », par exemple 12,50.';
  }
  return '';
}
function obValidate() {
  const id = OB_STEPS[OB.step];
  if (id === 'profil' && OB.pro) {
    const r = parseAmount(OB.rate);
    if (!(r > 0 && r < 100)) return 'Indique ton taux URSSAF, par exemple 21,2.';
  }
  if (id === 'revenus') return obCheckRows('rev');
  if (id === 'charges') return obCheckRows('dep');
  if (id === 'epargne' && OB.ep) return obCheckRows('ep');
  return '';
}
function obGo(step) {
  const dir = step > OB.step ? 1 : -1;
  OB.step = Math.max(0, Math.min(OB_STEPS.length - 1, step));
  $('#o-error').textContent = '';
  obRender(dir);
  window.scrollTo(0, 0);
}
function obSkip() {
  const id = OB_STEPS[OB.step];
  if (id === 'profil') {
    // Nouveau compte : particulier par défaut. « Refaire la configuration » : on garde le profil actuel.
    if (OB.redo) { OB.pro = isPro(); OB.rate = isPro() ? amountStr(rateFor(NOW.getFullYear())) : ''; OB.period = S.settings.periodicite; }
    else { OB.pro = false; OB.rate = ''; OB.period = 'mensuelle'; }
  }
  else if (id === 'revenus') OB.rev = [];
  else if (id === 'charges') OB.dep = [];
  else if (id === 'epargne') { if (!OB.redo) OB.ep = null; OB.comptes = []; }
  obGo(OB.step + 1);
}
function obFinish() {
  if (OB.busy) return;
  if (S.readOnly) { blocked(); return; }
  OB.busy = true; $('#ob-next').disabled = true; // un double appui ne doit rien enregistrer deux fois
  const now = Date.now(); let n = 0;
  const jobs = [];
  const fixe = (type, r) => {
    const amount = parseAmount(r.amount), label = r.label.trim().replace(/\s+/g, ' '), start = YM_RE.test(r.start) ? r.start : CUR;
    if (r.freq === 'mois') jobs.push(addDoc(ucol('recurring'), { type, label, amount, urssaf: false, start, end: null, createdAt: now + n++ }));
    else jobs.push(addDoc(ucol('periodiques'), { type, label, amount, urssaf: false, freq: r.freq, start, end: null, createdAt: now + n++ }));
  };
  OB.rev.forEach(r => fixe('revenu', r));
  OB.dep.forEach(r => fixe('depense', r));
  if (OB.ep) for (const r of OB.comptes) {
    const label = r.label.trim().replace(/\s+/g, ' ');
    if (String(r.amount).trim()) jobs.push(addDoc(ucol('epargne'), { op: 'solde', label, amount: parseAmount(r.amount), date: TODAY, month: CUR, createdAt: now + n++ }));
    if (String(r.auto || '').trim()) {
      // Premier versement le mois prochain : le solde du jour inclut déjà ce mois-ci.
      jobs.push(addDoc(ucol('periodiques'), { type: 'epargne', label, amount: parseAmount(r.auto), urssaf: false, freq: FREQ[r.freq] ? r.freq : 'mois', start: addM(CUR, 1), end: null, createdAt: now + n++ }));
    }
  }
  const st = { pro: OB.pro, periodicite: OB.pro ? OB.period : (OB.redo ? S.settings.periodicite : 'mensuelle') };
  const yr = NOW.getFullYear(), rate = parseAmount(OB.rate);
  if (OB.pro && (!OB.redo || !isPro() || rate !== rateFor(yr) || S.settings.taux[yr] == null)) st.taux = { [String(yr)]: rate };
  if (OB.ep !== null) st.epargne = !!OB.ep;
  if (OB.drive && !(OB.redo && bkCfg().drive)) st.sauvegarde = { drive: true, frequence: 'mensuelle', derniere: 0 };
  if (!OB.redo) { st.createdAt = serverTimestamp(); S.justOnboarded = true; lsSet('pf-nouveautes', NOTES_VERSION); }
  // Les opérations d'abord, les réglages ensuite : l'appli s'ouvre avec tout ce qui vient d'être saisi.
  jobs.push(setDoc(uref('meta', 'settings'), st, { merge: true }));
  write(Promise.all(jobs), OB.redo ? 'Configuration enregistrée' : 'Bienvenue sur P-Flow');
  if (OB.redo) { OB.redo = false; OB.busy = false; show('app'); S.view = 'mois'; S.sub = null; render(); requestAnimationFrame(() => positionIndicator(false)); }
}
$('#s-onboard').addEventListener('click', e => {
  const b = e.target.closest('[data-ob], #ob-next, #ob-skip, #ob-back'); if (!b) return;
  const a = b.dataset.ob || b.id;
  if (a === 'ob-next') {
    const err = obValidate();
    if (err) { $('#o-error').textContent = err; return; }
    if (OB.step === OB_STEPS.length - 1) obFinish(); else obGo(OB.step + 1);
  } else if (a === 'ob-skip') obSkip();
  else if (a === 'ob-back') {
    if (OB.step > 0) obGo(OB.step - 1);
    else if (OB.redo) { OB.redo = false; show('app'); render(); requestAnimationFrame(() => positionIndicator(false)); }
  } else if (a === 'pro') { OB.pro = b.dataset.pro === '1'; obRender(0); if (OB.pro) { const r = $('#o-rate'); if (r) r.focus(); } }
  else if (a === 'period') { OB.period = b.dataset.p; obRender(0); }
  else if (a === 'ep') { OB.ep = b.dataset.v === '1'; if (!OB.ep) OB.comptes = []; obRender(0); }
  else if (a === 'add') {
    const k = b.dataset.k, list = OB[k === 'ep' ? 'comptes' : k];
    list.push(k === 'ep' ? { label: b.dataset.l, amount: '', auto: '', freq: 'mois' } : { label: b.dataset.l, amount: '', freq: 'mois', start: CUR });
    obRender(0);
    const rows = $$('#ob-step .ob-row'), last = rows[rows.length - 1];
    if (last) { riseIn(last); const f = b.dataset.l ? $('[data-f="amount"]', last) : $('[data-f="label"]', last); if (f) f.focus(); }
  } else if (a === 'del') {
    const row = b.closest('.ob-row'), k = row.dataset.kind;
    OB[k === 'ep' ? 'comptes' : k].splice(+row.dataset.i, 1); obRender(0);
  } else if (a === 'theme') { setAppearance('theme', b.dataset.t); obRender(0); }
  else if (a === 'texte') { setAppearance('texte', b.dataset.t); obRender(0); }
  else if (a === 'drive') {
    OB.busy = true; OB.driveMsg = '';
    const tok = driveToken(true); // tout de suite : la fenêtre Google demande un geste de l'utilisateur
    obRender(0);
    tok.then(() => { OB.drive = true; }, x => { OB.driveMsg = x && x.code === 'CANCELED' ? '' : driveErr(x); })
      .finally(() => { OB.busy = false; if (!$('#s-onboard').hidden) obRender(0); });
  }
});
$('#s-onboard').addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'o-rate') { OB.rate = t.value; return; }
  const row = t.closest('.ob-row'); if (!row || !t.dataset.f) return;
  const r = OB[row.dataset.kind === 'ep' ? 'comptes' : row.dataset.kind][+row.dataset.i];
  if (r) r[t.dataset.f] = t.value;
});
$('#s-onboard').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.ob === 'noir') { setAppearance('noir', t.checked); return; }
  const row = t.closest('.ob-row'); if (!row || !t.dataset.f) return;
  const r = OB[row.dataset.kind === 'ep' ? 'comptes' : row.dataset.kind][+row.dataset.i];
  if (r) r[t.dataset.f] = t.value;
});

/* ---------- rendu ---------- */
function render() {
  if (!S.ready) return;
  const on = epOn();
  document.body.classList.toggle('ep-on', on);
  if (S.view === 'reglages' && S.sub && (!SUBS[S.sub] || (S.sub === 'pro' && !isPro()) || (S.sub === 'admin' && !S.isAdmin))) S.sub = null;
  $$('.view').forEach(el => { el.hidden = el.id !== 'v-' + S.view; });
  $$('[data-act="view"]').forEach(b => { if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('.tabbar').dataset.view = S.view;
  renderCtx(); updateSync(); renderReqBanner();
  if (S.view === 'mois') renderMois();
  else if (S.view === 'fixes') renderFixes();
  else if (S.view === 'annee') renderAnnee();
  else renderReglages();
  maybeAutoBackup();
}
function updateSync() {
  let s = 'connecting', t = 'Connexion…';
  const pending = Object.values(S.pend).some(Boolean);
  if (!navigator.onLine) { s = 'off'; t = pending ? 'Hors ligne · en attente d\'envoi' : 'Hors ligne'; }
  else if (pending) { s = 'pending'; t = 'Envoi…'; }
  else if (ready()) { s = 'ok'; t = 'Synchronisé'; }
  const icon = { ok: 'cloud-ok', pending: 'cloud-up', off: 'cloud-off', connecting: 'cloud' }[s];
  $$('.sync').forEach(el => {
    if (el.dataset.s === s && el.title === t) return;
    el.dataset.s = s; el.title = t;
    if (el.hasAttribute('role')) el.setAttribute('aria-label', t);
    $('.txt', el).textContent = t;
    $('use', el).setAttribute('href', '#i-' + icon);
  });
}
window.addEventListener('online', updateSync);
window.addEventListener('offline', updateSync);

const ico = (id, cls) => '<svg class="i' + (cls ? ' ' + cls : '') + '"><use href="#i-' + id + '"/></svg>';
function renderCtx() {
  const c = $('#ctx');
  let h;
  if (S.view === 'mois') {
    h = '<button class="icon-btn" data-act="prev-month" aria-label="Mois précédent">' + ico('left') + '</button><h1>' + esc(cap(mLabel(S.month))) + '</h1><button class="icon-btn" data-act="next-month" aria-label="Mois suivant">' + ico('right') + '</button>';
  } else if (S.view === 'annee') {
    h = '<button class="icon-btn" data-act="prev-year" aria-label="Année précédente">' + ico('left') + '</button><h1>' + S.year + '</h1><button class="icon-btn" data-act="next-year" aria-label="Année suivante">' + ico('right') + '</button>';
  } else if (S.view === 'reglages' && S.sub) {
    h = '<button class="back" data-act="sub-back" aria-label="Retour aux réglages">' + ico('left') + 'Réglages</button><h1>' + esc(SUBS[S.sub]) + '</h1>';
  } else {
    h = '<h1 style="padding-left:6px">' + (S.view === 'fixes' ? 'Charges et revenus fixes' : 'Réglages') + '</h1>';
  }
  c.innerHTML = h;
}

/* ----- lignes d'opérations ----- */
const ROW_ACT = { entry: 'edit-entry', rec: 'edit-rec', per: 'edit-per', ep: 'edit-ep', auto: 'edit-per' };
const OP_LABEL = { depot: 'mis de côté', retrait: 'repris', solde: 'solde du compte' };
function rowHtml(it, rate, extraCls) {
  const isEp = it.kind === 'ep' || it.kind === 'auto';
  const isRev = !isEp && it.type === 'revenu';
  const meta = [];
  if (it.kind === 'entry' || it.kind === 'ep') meta.push(dLabel(it.date));
  if (it.kind === 'per') meta.push(FREQ_LABEL[it.freq]);
  if (it.kind === 'ep') meta.push(OP_LABEL[it.op] || '');
  if (it.kind === 'auto') meta.push('versement automatique');
  if (isRev && isPro()) meta.push(it.urssaf ? 'URSSAF ' + MINUS + eur(it.amount * rate / 100) : 'sans URSSAF');
  const tag = it.kind === 'rec' || it.kind === 'per' ? '<span class="tag">fixe</span>' : '';
  const back = isEp && it.op === 'retrait';
  const sign = isEp ? (it.op === 'solde' ? '' : back ? '+' : MINUS) : isRev ? '+' : MINUS;
  const ic = isEp ? '<span class="row-ico ep">' + ico('epargne') + '</span>' : isRev ? '<span class="row-ico in">' + ico('in') + '</span>' : '<span class="row-ico">' + ico('out') + '</span>';
  return '<button class="row' + (extraCls ? ' ' + extraCls : '') + '" data-act="' + ROW_ACT[it.kind] + '" data-id="' + esc(it.id) + '">' + ic +
    '<span class="row-main"><span class="row-label">' + esc(it.label) + tag + '</span>' +
    (meta.length ? '<span class="row-meta">' + esc(meta.filter(Boolean).join(' · ')) + '</span>' : '') + '</span>' +
    '<span class="row-amt' + (isEp ? ' ep' : isRev ? ' in' : '') + '">' + sign + eur(it.amount) + '</span></button>';
}
const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);

/* ----- vue Mois ----- */
let heroVal = null, heroRaf = 0;
function setHero(v) {
  const el = $('#hero-amount');
  cancelAnimationFrame(heroRaf);
  if (heroVal == null || !motionOK() || heroVal === v || $('#v-mois').hidden) { el.textContent = eur(v); heroVal = v; return; }
  const from = heroVal, t0 = performance.now(), D = 460;
  heroVal = v;
  const step = t => {
    const p = Math.min(1, (t - t0) / D), k = 1 - Math.pow(1 - p, 3);
    el.textContent = eur(p < 1 ? from + (v - from) * k : v);
    if (p < 1) heroRaf = requestAnimationFrame(step);
  };
  heroRaf = requestAnimationFrame(step);
}
function heroSubHtml(d, m) {
  const parts = [];
  if (m === CUR) {
    const dim = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate(), left = dim - NOW.getDate() + 1;
    if (d.reste > 0) parts.push('soit <b>~' + esc(eur0(d.reste / left)) + '</b> par jour jusqu\'au ' + dim + ' ' + MONTHS[NOW.getMonth()]);
    else if (d.reste < 0) parts.push('Tes dépenses dépassent tes revenus ce mois-ci');
  }
  const pm = addM(m, -1);
  if (pYM(pm).y === S.entriesYear) { // le mois d'avant doit être chargé pour comparer
    const p = monthData(pm);
    if (p.dep > 0 && d.dep > 0) {
      const pct = Math.round((d.dep - p.dep) / p.dep * 100), mo = MONTHS[pYM(pm).m - 1];
      parts.push(pct === 0 ? 'Dépenses : comme en ' + mo
        : 'Dépenses : <span class="' + (pct > 0 ? 'up' : 'down') + '">' + (pct > 0 ? '+' : MINUS) + Math.abs(pct) + ' %</span> par rapport à ' + mo);
    }
  }
  return parts.map(p => '<span>' + p + '</span>').join('');
}
function cascadeHtml(d, ok, pro, on) {
  const apresDep = r2(d.net - d.dep);
  const lo = Math.min(0, apresDep, d.reste), hi = Math.max(d.brut, d.net, 0);
  const X = v => (hi - lo > 0 ? (v - lo) / (hi - lo) * 100 : 0);
  const bar = (cls, a, b) => {
    const x1 = X(Math.min(a, b)), x2 = X(Math.max(a, b));
    return '<span class="cb">' + (lo < 0 ? '<span class="zero" style="left:' + X(0).toFixed(2) + '%"></span>' : '') +
      (x2 - x1 > 0.01 ? '<i class="' + cls + '" style="left:' + x1.toFixed(2) + '%;width:' + (x2 - x1).toFixed(2) + '%"></i>' : '') + '</span>';
  };
  const rows = [];
  if (pro) {
    rows.push(['', 's-brut', 'Revenus bruts', d.brut, bar('s-brut', 0, d.brut)]);
    rows.push([MINUS, 's-urssaf', 'URSSAF (' + pctf(d.rate) + ')', d.urssaf, bar('s-urssaf', d.net, d.brut)]);
    rows.push(['=', 's-net', 'Revenus nets', d.net, bar('s-net', 0, d.net), 'sub']);
  } else rows.push(['', 's-net', 'Revenus', d.brut, bar('s-net', 0, d.brut)]);
  rows.push([MINUS, 's-dep', 'Dépenses', d.dep, bar('s-dep', apresDep, d.net)]);
  if (on) rows.push([d.ep < 0 ? '+' : MINUS, 's-ep', d.ep < 0 ? 'Épargne reprise' : 'Épargne', Math.abs(d.ep), bar('s-ep', d.reste, apresDep)]);
  const neg = d.reste < 0;
  rows.push(['=', neg ? 's-manque' : 's-reste', neg ? 'Il manque' : 'Reste', Math.abs(d.reste), bar(neg ? 's-manque' : 's-reste', 0, d.reste), 'tot']);
  return rows.map(r => '<div' + (r[5] ? ' class="' + r[5] + '"' : '') + '><dt><span class="op">' + r[0] + '</span><i class="sw ' + r[1] + '"></i>' + esc(r[2]) + '</dt><dd>' + (ok ? eur(r[3]) : '…') + '</dd>' + (ok ? r[4] : '') + '</div>').join('');
}
function renderMois() {
  const m = S.month, ok = ready(), d = monthData(m), pro = isPro(), on = epOn();
  const bt = $('#back-today');
  bt.hidden = m === CUR; bt.textContent = 'Revenir à ' + MONTHS[pYM(CUR).m - 1];
  const amt = $('#hero-amount');
  amt.className = 'big' + (ok ? (d.reste < 0 ? ' neg' : ' pos') : '');
  if (ok) setHero(d.reste); else { amt.textContent = '…'; heroVal = null; }
  $('#hero-sub').innerHTML = ok ? heroSubHtml(d, m) : '<span>Chargement…</span>';
  $('#legend').innerHTML = cascadeHtml(d, ok, pro, on);
  $('#ep-offer').hidden = !(ok && S.settings.epargne === null && !on && !S.readOnly);
  if (pro) renderUrssaf(m, ok);
  if (on) renderEpCard(d, ok);

  const lists = $('#lists');
  if (!ok) { lists.innerHTML = '<p class="empty">Chargement…</p>'; return; }
  const revs = d.items.filter(i => i.type === 'revenu').sort((a, b) => (a.kind === b.kind ? byDate(a, b) : (a.kind === 'entry' ? -1 : 1)));
  const depE = d.ents.filter(i => i.type !== 'revenu').sort(byDate);
  const depR = d.recs.concat(d.pers).filter(i => i.type !== 'revenu').sort((a, b) => b.amount - a.amount);
  const epI = d.eps.concat(d.autos).sort(byDate);
  let h = '';
  h += '<section class="group"><div class="group-head"><h3>Revenus</h3><span class="sum">' + (revs.length ? '+' + eur(sumOf(revs)) : '') + '</span></div>' +
    (revs.length ? revs.map(i => rowHtml(i, d.rate)).join('') : '<p class="empty">Aucun revenu noté pour ' + esc(mLabel(m)) + '. Ajoute-le avec <b>+</b> puis « Revenu ».</p>') + '</section>';
  h += '<section class="group"><div class="group-head"><h3>Dépenses du mois</h3><span class="gh-tools">' +
    (depE.length > 1 ? '<button class="toggle-mini" data-act="group-toggle" aria-pressed="' + S.grouped + '" title="Regrouper par libellé">' + ico(S.grouped ? 'group' : 'list') + (S.grouped ? 'Par libellé' : 'Par date') + '</button>' : '') +
    '<span class="sum">' + (depE.length ? MINUS + eur(sumOf(depE)) : '') + '</span></span></div>' +
    (depE.length ? (S.grouped ? groupedHtml(depE, d.rate) : depE.map(i => rowHtml(i, d.rate)).join('')) : '<p class="empty">Aucune dépense notée. Ajoute-la avec <b>+</b> : tu écris toi-même à quoi elle correspond.</p>') + '</section>';
  if (depR.length) {
    h += '<section class="group"><button class="group-head" data-act="toggle-fixed" aria-expanded="' + S.showFixed + '"><span class="gh-left">' + ico('right', 'chev') + '<span class="h3">Charges fixes · ' + depR.length + '</span></span><span class="sum">' + MINUS + eur(sumOf(depR)) + '</span></button>' +
      (S.showFixed ? depR.map(i => rowHtml(i, d.rate)).join('') : '') + '</section>';
  }
  if (on && epI.length) {
    h += '<section class="group"><div class="group-head"><h3>Épargne du mois</h3><span class="sum">' + (d.ep ? (d.ep > 0 ? MINUS : '+') + eur(Math.abs(d.ep)) : '') + '</span></div>' + epI.map(i => rowHtml(i, d.rate)).join('') + '</section>';
  }
  lists.innerHTML = h;
}
// Dépenses regroupées par libellé : « Courses ×2 · 405 € », touchées = détail.
function groupedHtml(items, rate) {
  const map = new Map();
  for (const it of items) { const k = norm(it.label); const g = map.get(k) || { k, label: it.label, items: [] }; g.items.push(it); map.set(k, g); }
  return Array.from(map.values()).sort((a, b) => sumOf(b.items) - sumOf(a.items)).map(g => {
    if (g.items.length === 1) return rowHtml(g.items[0], rate);
    const open = S.openGroups.has(g.k);
    return '<button class="row" data-act="grp-open" data-k="' + esc(g.k) + '" aria-expanded="' + open + '"><span class="row-ico">' + ico('group') + '</span><span class="row-main"><span class="row-label">' + esc(g.label) + ' <span class="tag">×' + g.items.length + '</span></span>' +
      '<span class="row-meta">dernière le ' + esc(dLabel(g.items[0].date)) + '</span></span><span class="row-amt">' + MINUS + eur(sumOf(g.items)) + '</span></button>' +
      (open ? g.items.map(i => rowHtml(i, rate, 'child')).join('') : '');
  }).join('');
}
function renderUrssaf(m, ok) {
  const u = urssafPeriod(m), today0 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  const past = u.dl < today0, soon = !past && u.total > 0 && (u.dl - NOW) < 15 * 864e5;
  const dlTxt = u.dl.getDate() + ' ' + MONTHS[u.dl.getMonth()] + ' ' + u.dl.getFullYear();
  const line = $('#urssaf-line');
  line.innerHTML = '<i class="sw s-urssaf"></i><span class="t"><b>' + (ok ? eur(u.total) : '…') + '</b><span>' + esc(u.title) + (u.sub ? ' (' + esc(u.sub) + ')' : '') + ' · ' + (past ? 'échéance passée' : 'avant le ' + esc(u.dl.getDate() + ' ' + MONTHS[u.dl.getMonth()])) + '</span></span>' + ico('down', 'chev');
  line.classList.toggle('late', soon);
  line.setAttribute('aria-expanded', String(S.ucOpen));
  $('#urssaf-card').hidden = !S.ucOpen;
  if (!S.ucOpen) return;
  $('#uc-info').innerHTML =
    '<p class="uc-amount">' + (ok ? eur(u.total) : '…') + '</p>' +
    '<p class="hint">' + (ok ? (u.base > 0 ? 'Sur ' + eur(u.base) + " de chiffre d'affaires" + (u.rate != null ? ' à ' + pctf(u.rate) : '') : "Aucun chiffre d'affaires noté pour cette période.") : '') + '</p>' +
    '<p class="uc-due' + (soon ? ' late' : '') + '">' + (past ? 'Échéance passée : ' : 'À déclarer et payer au plus tard le ') + esc(dlTxt) + '</p>';
  $('#sim').hidden = !S.simOpen; $('#sim-btn').setAttribute('aria-expanded', String(S.simOpen));
  if (S.simOpen) calc();
}
function renderEpCard(d, ok) {
  const cs = comptes(), total = r2(cs.reduce((a, c) => a + c.solde, 0)), mo = MONTHS[pYM(d.m).m - 1];
  const mline = [d.epIn ? 'mis de côté ' + eur(d.epIn) : '', d.epOut ? 'repris ' + eur(d.epOut) : ''].filter(Boolean).join(' · ');
  $('#ep-card').innerHTML = '<div class="ep-head"><h3>Épargne</h3><span class="ep-total">' + (ok ? eur(total) : '…') + '</span></div>' +
    (mline ? '<p class="ep-month">En ' + esc(mo) + ' : ' + esc(mline) + '</p>' : '') +
    (cs.length ? '<div>' + cs.map(c => '<button class="row" data-act="compte-open" data-k="' + esc(c.key) + '"><span class="row-ico ep">' + ico('epargne') + '</span><span class="row-main"><span class="row-label">' + esc(c.label) + '</span>' +
      (c.autos.length ? '<span class="row-meta">' + esc(c.autos.map(p => eur(p.amount) + ' ' + FREQ_LABEL[p.freq]).join(' · ')) + '</span>' : '') + '</span><span class="row-amt">' + eur(c.solde) + '</span></button>').join('') + '</div>'
      : '<p class="empty">Aucun compte pour l\'instant : touche <b>Épargne</b> pour noter ce que tu as ou ce que tu mets de côté.</p>');
}

/* ----- vue Fixes ----- */
function renderFixes() {
  const ok = ready(), on = epOn(), pro = isPro();
  const active = x => x.start && x.start <= CUR && (!x.end || x.end >= CUR);
  const recs = S.recurring.map(r => Object.assign({ kind: 'rec', freq: 'mois' }, r));
  const pers = S.periodiques.filter(p => PER_TYPES.includes(p.type) && perStep(p) && (p.type !== 'epargne' || on)).map(p => Object.assign({ kind: 'per' }, p));
  const all = recs.concat(pers);
  const act = all.filter(active), up = all.filter(r => r.start > CUR && !(r.end && r.end < r.start)), ended = all.filter(r => r.end && r.end < CUR && r.end >= r.start);
  const rev = act.filter(r => r.type === 'revenu'), epx = act.filter(r => r.kind === 'per' && r.type === 'epargne');
  const dep = act.filter(r => r.type !== 'revenu' && !(r.kind === 'per' && r.type === 'epargne'));
  const perMonth = x => (Number(x.amount) || 0) / (FREQ[x.freq] || 1);
  const rate = rateFor(NOW.getFullYear());
  const revM = r2(rev.reduce((a, x) => a + perMonth(x) * (pro && x.urssaf ? 1 - rate / 100 : 1), 0));
  const depM = r2(dep.reduce((a, x) => a + perMonth(x), 0)), epM = r2(epx.reduce((a, x) => a + perMonth(x), 0));
  const left = r2(revM - depM - epM);
  const smooth = act.some(x => x.freq !== 'mois');
  $('#fix-totals').innerHTML =
    '<div class="fix-main"><span>Après les fixes, il te reste</span><strong class="' + (left < 0 ? 'neg' : '') + '">' + (ok ? eur(left) : '…') + '</strong><span>par mois' + (smooth ? ' (trimestriels et annuels comptés en moyenne)' : '') + '</span>' +
    (ok && left < 0 && pro ? '<p class="hint">Tes factures et autres revenus qui varient ne sont pas comptés ici : seulement ce qui revient tout seul.</p>' : '') + '</div>' +
    '<div class="fix-small"><div><span><i class="sw s-dep"></i>Charges fixes</span><b>' + (ok ? eur(depM) : '…') + '</b></div>' +
    '<div><span><i class="sw s-net"></i>Revenus fixes' + (pro && rev.some(x => x.urssaf) ? ' nets' : '') + '</span><b>' + (ok ? eur(revM) : '…') + '</b></div>' +
    (on ? '<div><span><i class="sw s-ep"></i>Épargne auto</span><b>' + (ok ? eur(epM) : '…') + '</b></div>' : '') + '</div>';
  const list = $('#fix-list');
  if (!ok) { list.innerHTML = '<p class="empty">Chargement…</p>'; return; }
  const row = r => {
    const isRev = r.type === 'revenu', isEp = r.kind === 'per' && r.type === 'epargne';
    const nx = r.freq !== 'mois' && active(r) ? perNext(r, CUR) : null;
    const meta = [FREQ_LABEL[r.freq], (r.start > CUR ? 'à partir de ' : 'depuis ') + mShort(r.start)];
    if (r.end) meta.push('jusqu\'à ' + mShort(r.end));
    if (nx) meta.push(nx === CUR ? 'échéance ce mois-ci' : 'prochaine : ' + mLabel(nx));
    if (isRev && pro) meta.push(r.urssaf ? 'soumis URSSAF' : 'sans URSSAF');
    const ic = isEp ? '<span class="row-ico ep">' + ico('epargne') + '</span>' : isRev ? '<span class="row-ico in">' + ico('in') + '</span>' : '<span class="row-ico">' + ico('out') + '</span>';
    return '<button class="row" data-act="' + (r.kind === 'rec' ? 'edit-rec' : 'edit-per') + '" data-id="' + esc(r.id) + '">' + ic + '<span class="row-main"><span class="row-label">' + esc(r.label) + '</span><span class="row-meta">' + esc(meta.join(' · ')) + '</span></span>' +
      '<span class="row-amt' + (isEp ? ' ep' : isRev ? ' in' : '') + '">' + (isRev ? '+' : MINUS) + eur(r.amount) + '<small>' + FREQ_UNIT[r.freq] + '</small></span></button>';
  };
  const sortA = arr => arr.slice().sort((a, b) => perMonth(b) - perMonth(a));
  let h = '';
  h += '<section class="group"><div class="group-head"><h3>Charges</h3><span class="sum">' + (dep.length ? MINUS + eur(depM) + '/mois' : '') + '</span></div>' + (dep.length ? sortA(dep).map(row).join('') : '<p class="empty">Aucune charge fixe pour l\'instant. Ajoute ton loyer, tes abonnements, tes crédits… avec <b>+</b>.</p>') + '</section>';
  if (rev.length) h += '<section class="group"><div class="group-head"><h3>Revenus</h3><span class="sum">+' + eur(rev.reduce((a, x) => a + perMonth(x), 0)) + '/mois</span></div>' + sortA(rev).map(row).join('') + '</section>';
  if (epx.length) h += '<section class="group"><div class="group-head"><h3>Épargne automatique</h3><span class="sum">' + MINUS + eur(epM) + '/mois</span></div>' + sortA(epx).map(row).join('') + '</section>';
  if (up.length) h += '<section class="group"><div class="group-head"><h3>À venir</h3></div>' + sortA(up).map(row).join('') + '</section>';
  if (ended.length) h += '<section class="group"><button class="group-head" data-act="toggle-ended" aria-expanded="' + S.showEnded + '"><span class="gh-left">' + ico('right', 'chev') + '<span class="h3">Terminés · ' + ended.length + '</span></span></button>' + (S.showEnded ? sortA(ended).map(row).join('') : '') + '</section>';
  list.innerHTML = h;
}

/* ----- vue Année ----- */
function yearData(y) {
  const months = [];
  for (let i = 1; i <= 12; i++) { const d = monthData(ym(y, i)); d.fut = d.m > CUR; d.now = d.m === CUR; months.push(d); }
  const counted = months.filter(d => !d.fut);
  const T = { brut: 0, base: 0, urssaf: 0, net: 0, dep: 0, ep: 0, reste: 0 };
  for (const d of counted) for (const k in T) T[k] += d[k];
  for (const k in T) T[k] = r2(T[k]);
  const n = counted.length;
  const map = new Map();
  for (const d of counted) for (const it of d.items) if (it.type !== 'revenu') {
    const k = norm(it.label); const c = map.get(k) || { k, label: it.label, total: 0, rec: false, items: [] };
    c.total += Number(it.amount) || 0; if (it.kind !== 'entry') c.rec = true; c.items.push(Object.assign({ m: d.m }, it)); map.set(k, c);
  }
  return { months, counted, n, T, avg: n ? r2(T.reste / n) : 0, avgDep: n ? r2(T.dep / n) : 0, top: Array.from(map.values()).sort((a, b) => b.total - a.total) };
}
let lastChartW = 0, YD = null;
function renderAnnee() {
  const y = S.year, ok = ready(), yd = yearData(y), T = yd.T, pro = isPro(), on = epOn();
  YD = yd;
  const n = yd.n, neg = T.reste < 0;
  const mini = (sw, label, v) => '<div class="mini"><span><i class="sw ' + sw + '"></i>' + label + '</span><b>' + (ok ? eur(v) : '…') + '</b></div>';
  $('#kpis').innerHTML = '<p class="eyebrow">' + (neg ? 'Il manque sur l\'année' : 'Reste de l\'année') + '</p>' +
    '<p class="big ' + (ok ? (neg ? 'neg' : 'pos') : '') + '">' + (ok ? eur(Math.abs(T.reste)) : '…') + '</p>' +
    '<p class="hero-sub"><span>' + (!ok ? 'Chargement…' : n === 0 ? 'L\'année ' + y + ' n\'a pas encore commencé.' : 'soit <b>' + esc(eur(yd.avg)) + '</b> par mois en moyenne, sur ' + n + ' mois') + '</span></p>' +
    '<div class="minis">' + (pro ? mini('s-brut', 'Revenus bruts', T.brut) + mini('s-urssaf', 'URSSAF', T.urssaf) + mini('s-net', 'Revenus nets', T.net) : mini('s-net', 'Revenus', T.brut)) +
    mini('s-dep', 'Dépenses', T.dep) + (on ? mini('s-ep', 'Épargne', T.ep) : '') + '</div>';
  $('#y-period').textContent = !ok || n === 0 ? '' : n === 12 ? 'Année ' + y + ' complète.' : 'De janvier à ' + MONTHS[n - 1] + ' ' + y + '. Les mois suivants sont des prévisions (fixes seulement), en pâle.';
  $('#chart-legend').innerHTML = '<span><i class="sw s-reste"></i>Reste</span><span><i class="sw" style="background:var(--neg)"></i>Manque</span><span><i class="dash"></i>Dépenses moy. ' + (ok ? esc(eur0(yd.avgDep)) : '') + '</span>';
  lastChartW = 0; renderChart();
  // Tableau, « Où part l'argent » et seuils (sous le graphique) : après l'animation d'arrivée sur l'écran,
  // pour que l'écran apparaisse tout de suite, même sur un vieux téléphone.
  clearTimeout(yearLater);
  if (S.deferYear && motionOK()) { S.deferYear = false; const key = y; yearLater = setTimeout(() => { if (S.view === 'annee' && S.year === key) renderAnneeBottom(yd, ok, pro, on); }, 360); }
  else { S.deferYear = false; renderAnneeBottom(yd, ok, pro, on); }
}
let yearLater = 0;
function renderAnneeBottom(yd, ok, pro, on) {
  const y = yd.months[0].m.slice(0, 4), T = yd.T;
  let rows = '';
  for (const d of yd.months) {
    const cls = ['go', d.fut ? 'fut' : '', d.now ? 'now' : ''].join(' ');
    rows += '<tr class="' + cls + '" data-act="goto-month" data-month="' + d.m + '"><td><button class="cell-btn" data-act="goto-month" data-month="' + d.m + '">' + cap(MONTHS[pYM(d.m).m - 1]) + '</button>' + (d.fut ? '<small class="prev-l">prévision</small>' : '') + '</td>' +
      '<td>' + n0(d.net) + '</td><td>' + n0(d.dep) + '</td>' + (on ? '<td>' + n0(d.ep) + '</td>' : '') + '<td class="' + (d.fut ? '' : (d.reste < 0 ? 'neg' : 'pos')) + '">' + n0(d.reste) + '</td></tr>';
  }
  $('#y-table').innerHTML = ok ? '<table><caption>Montants en euros, arrondis</caption><thead><tr><th>Mois</th><th>' + (pro ? 'Nets' : 'Revenus') + '</th><th>Dépenses</th>' + (on ? '<th>Épargne</th>' : '') + '<th>Reste</th></tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td>Total</td><td>' + n0(T.net) + '</td><td>' + n0(T.dep) + '</td>' + (on ? '<td>' + n0(T.ep) + '</td>' : '') + '<td class="' + (T.reste < 0 ? 'neg' : 'pos') + '">' + n0(T.reste) + '</td></tr></tfoot></table>' : '<p class="empty">Chargement…</p>';
  // Où part l'argent : 6 premiers libellés + « Autres », en % du total des dépenses.
  const TOPN = 6, top = yd.top.slice(0, TOPN), rest = yd.top.slice(TOPN), tot = T.dep || 1;
  const others = rest.length ? { k: '__autres', label: 'Autres', total: rest.reduce((a, c) => a + c.total, 0), n: rest.length } : null;
  const maxT = Math.max(top.length ? top[0].total : 0, others ? others.total : 0) || 1;
  const topRow = c => '<button class="top-row" data-act="top-open" data-k="' + esc(c.k) + '"><span class="l">' + esc(c.label) + (c.n ? '<small>' + c.n + ' libellés</small>' : c.rec ? '<small>fixe</small>' : '') + '</span>' +
    '<span class="a">' + eur(c.total) + '<small>' + Math.round(c.total / tot * 100) + ' %</small></span>' +
    '<span class="bar"><i class="' + (c.rec ? '' : 'p') + '" style="width:' + Math.max(2, c.total / maxT * 100).toFixed(1) + '%"></i></span></button>';
  $('#y-top').innerHTML = !ok ? '<p class="empty">Chargement…</p>' : top.length ? top.map(topRow).join('') + (others ? topRow(others) : '') : '<p class="empty">Aucune dépense sur cette période.</p>';
  if (pro) {
    const meter = (label, v, lim) => {
      const p = v / lim, cls = p >= 1 ? 'over' : p >= 0.8 ? 'warn' : '';
      return '<div class="meter ' + cls + '"><div class="meter-top"><b>' + label + '</b><span>' + eur(v) + ' / ' + eur(lim) + '</span></div><div class="bar"><i style="width:' + Math.min(100, Math.max(p * 100, v > 0 ? 1.5 : 0)).toFixed(1) + '%"></i></div></div>';
    };
    $('#y-meters').innerHTML = meter('Franchise de TVA', T.base, 37500) + meter('Plafond micro-entreprise', T.base, +y >= 2026 ? 83600 : 77700);
  }
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function axLabel(v) { const a = Math.abs(v), s = v < 0 ? MINUS : ''; return s + (a >= 1000 ? NUM.format(a / 1000) + ' k€' : NUM.format(a) + ' €'); }
let chartGeo = null;
function renderChart() {
  if (S.view !== 'annee' || !S.ready) return;
  const host = $('#chart');
  const W = Math.floor(chartW || host.clientWidth || 600);
  if (W === lastChartW && host.firstChild) return;
  lastChartW = W;
  hideBubble();
  if (!ready()) { host.innerHTML = ''; return; }
  const yd = YD && YD.months[0].m === ym(S.year, 1) ? YD : yearData(S.year);
  const H = W < 520 ? 210 : 250, pl = 46, pr = 8, pt = 12, pb = 26;
  const iw = W - pl - pr, ih = H - pt - pb;
  const vals = yd.months.map(d => d.reste);
  let hi = Math.max(50, yd.avgDep, ...vals), lo = Math.min(0, ...vals);
  const step = niceStep((hi - lo) / 4 || 100);
  hi = Math.ceil(hi / step) * step; lo = Math.floor(lo / step) * step;
  const Y = v => pt + (hi - v) / (hi - lo) * ih;
  const gw = iw / 12, bw = Math.max(6, Math.min(26, gw * 0.56));
  let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Reste de chaque mois en ' + S.year + '">';
  for (let v = lo; v <= hi + 0.001; v += step) {
    const yy = Math.round(Y(v)) + 0.5;
    s += '<line class="' + (Math.abs(v) < 1e-9 ? 'gl0' : 'gl') + '" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '"/>';
    s += '<text class="ax" x="' + (pl - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + axLabel(v) + '</text>';
  }
  const y0 = Y(0);
  yd.months.forEach((d, i) => {
    const x0 = pl + i * gw, cx = x0 + gw / 2, v = d.reste;
    const top = Y(Math.max(0, v)), h = Math.max(v === 0 ? 0 : 1.5, Math.abs(Y(v) - y0));
    s += '<g class="bar-g' + (d.fut ? ' fut' : '') + '" data-act="bar" data-i="' + i + '"><title>' + esc(cap(mLabel(d.m)) + (d.fut ? ' (prévision)' : '') + ' : reste ' + eur(v)) + '</title>' +
      '<rect class="b-hit" x="' + (x0 + 1) + '" y="' + pt + '" width="' + (gw - 2) + '" height="' + (ih + pb - 2) + '" rx="8"/>' +
      (h > 0 ? '<rect class="' + (v < 0 ? 'b-neg' : 'b-pos') + '" x="' + (cx - bw / 2) + '" y="' + (v < 0 ? y0 : top) + '" width="' + bw + '" height="' + h + '" rx="' + Math.min(5, bw / 3) + '"/>' : '') +
      '<text class="ax' + (d.now ? ' cur' : '') + '" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + (W < 520 ? MI[i] : MS[i].replace('.', '')) + '</text></g>';
  });
  if (yd.avgDep > 0) {
    const ya = Math.round(Y(yd.avgDep)) + 0.5;
    s += '<line class="avg-line" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + ya + '" y2="' + ya + '"/>';
  }
  host.innerHTML = s + '</svg>';
  chartGeo = { pl, gw, Y, W };
}
let chartW = 0;
if (window.ResizeObserver) new ResizeObserver(es => { const w = es[es.length - 1].contentRect.width; if (w > 0) chartW = w; renderChart(); }).observe($('#chart'));
function hideBubble() { const b = $('#bubble'); if (b) b.hidden = true; $$('#chart .bar-g.sel').forEach(g => g.classList.remove('sel')); S.bubble = null; }
function showBubble(i) {
  if (!chartGeo || !YD) return;
  const d = YD.months[i], b = $('#bubble'), on = epOn();
  if (S.bubble === i && !b.hidden) { hideBubble(); return; }
  hideBubble(); S.bubble = i;
  const g = $('#chart .bar-g[data-i="' + i + '"]'); if (g) g.classList.add('sel');
  const l = (k, v) => '<div class="l"><span>' + k + '</span><span>' + eur(v) + '</span></div>';
  b.innerHTML = '<b>' + esc(cap(mLabel(d.m))) + (d.fut ? ' · prévision' : '') + '</b>' + l(isPro() ? 'Revenus nets' : 'Revenus', d.net) + l('Dépenses', d.dep) + (on ? l('Épargne', d.ep) : '') + l(d.reste < 0 ? 'Il manque' : 'Reste', Math.abs(d.reste)) +
    '<button class="link" data-act="goto-month" data-month="' + d.m + '">Voir le mois</button>';
  b.hidden = false;
  const wrap = $('.chart-wrap'), bw = b.offsetWidth, bh = b.offsetHeight, W = wrap.clientWidth;
  const cx = chartGeo.pl + i * chartGeo.gw + chartGeo.gw / 2;
  const x = Math.max(0, Math.min(W - bw, cx - bw / 2)), y = Math.max(-8, chartGeo.Y(Math.max(0, d.reste)) - bh - 10);
  b.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  anim(b, [{ opacity: 0, transform: b.style.transform + ' translateY(6px) scale(.96)' }, { opacity: 1, transform: b.style.transform }], { duration: 220, easing: SPRING });
}

/* ----- vue Réglages ----- */
function renderReglages() {
  $('#set-home').hidden = !!S.sub;
  Object.keys(SUBS).forEach(k => { $('#sub-' + k).hidden = S.sub !== k; });
  const email = (S.user && S.user.email) || '';
  $('#acc-email').textContent = email;
  $('#acc-version').textContent = APP_VERSION;
  $('#sh-compte').textContent = email;
  $('#sh-pro').textContent = isPro() ? 'Taux ' + pctf(rateFor(NOW.getFullYear())) + ' · déclaration ' + S.settings.periodicite : '';
  $('#sh-apparence').textContent = { auto: 'Thème automatique', clair: 'Thème clair', sombre: 'Thème sombre' }[APP.theme] + (APP.noir ? ' · noir absolu' : '') + (APP.texte === 'grand' ? ' · grand texte' : '');
  $('#sh-donnees').textContent = bkCfg().drive ? 'Copies sur Google Drive activées' : 'Sauvegardes et export';
  $('#sh-apropos').textContent = 'Version ' + APP_VERSION;
  $('#sh-apropos-badge').hidden = !(UPD.state === 'available' || UPD.state === 'ready');
  $('#sh-admin-row').hidden = !S.isAdmin;
  $('#sh-admin').textContent = plural(S.allow.length, 'personne') + ' autorisée' + (S.allow.length > 1 ? 's' : '') + (S.demandes.length ? ' · ' + plural(S.demandes.length, 'demande') : '');
  const badge = $('#sh-admin-badge'); badge.hidden = !S.demandes.length; badge.textContent = S.demandes.length;
  $$('#profile-seg button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.pro === '1') === isPro())));
  const rates = $('#rates');
  if (isPro() && !rates.contains(document.activeElement)) {
    const ys = new Set(Object.keys(S.settings.taux).map(Number));
    ys.add(NOW.getFullYear()); ys.add(S.year);
    rates.innerHTML = Array.from(ys).sort((a, b) => b - a).map(y => '<label class="rate-row"><b>' + y + '</b><input class="input" data-year="' + y + '" inputmode="decimal" value="' + esc(NUM.format(rateFor(y))) + '" aria-label="Taux URSSAF ' + y + '"><span class="unit">%' + (S.settings.taux[y] == null ? ' <span class="hint">(repris)</span>' : '') + '</span></label>').join('');
  }
  $$('#period-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === S.settings.periodicite)));
  $('#ep-toggle').checked = epOn();
  $('#ep-toggle-hint').hidden = !(S.settings.epargne === false && (S.epargne.length || S.periodiques.some(p => p.type === 'epargne')));
  $$('#theme-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === APP.theme)));
  $$('#texte-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === APP.texte)));
  $('#noir-toggle').checked = APP.noir;
  $('#effets-toggle').checked = APP.effets === 'reduits';
  $('#export-btn').textContent = 'Exporter ' + S.year + ' en CSV';
  $('#admin-card').hidden = !S.isAdmin;
  $('#req-card').hidden = !S.isAdmin;
  renderAllow();
  renderReqList();
  renderColors();
  renderBackup();
  renderUpdate();
}
function renderColors() {
  const box = $('#colors');
  if (box.contains(document.activeElement) && document.activeElement.type === 'color') return; // sélecteur ouvert
  const c = S.settings.couleurs, cs = getComputedStyle(document.documentElement);
  const html = COLORS.filter(([, , proOnly]) => !proOnly || isPro()).map(([k, label]) => {
    const name = k === 'net' && !isPro() ? 'Revenus' : label;
    const open = S.colorOpen === k, cur = c[k] || '';
    const val = cur || (cs.getPropertyValue('--c-' + k).trim().toLowerCase());
    return '<div class="color-row">' +
      '<button type="button" class="color-head" data-act="color-open" data-k="' + k + '" aria-expanded="' + open + '"><i class="sw s-' + k + '"></i><span>' + esc(name) + '</span><small>' + (cur ? 'Personnalisée' : 'Par défaut') + '</small>' + ico('right', 'chev') + '</button>' +
      (open ? '<div class="palette" role="group" aria-label="Couleur : ' + esc(name) + '">' +
        PRESETS.map(([hex, n]) => '<button type="button" class="dot" data-act="color-set" data-k="' + k + '" data-c="' + hex + '" style="background:' + hex + '" aria-label="' + n + '" aria-pressed="' + (cur === hex) + '"></button>').join('') +
        '<label class="dot other" title="Autre couleur"><input type="color" data-k="' + k + '" value="' + (isHex(val) ? val : '#2453c4') + '" aria-label="Autre couleur"></label>' +
        (cur ? '<button type="button" class="link" data-act="color-reset" data-k="' + k + '">Par défaut</button>' : '') +
        '</div>' : '') +
      '</div>';
  }).join('');
  if (box.innerHTML !== html) box.innerHTML = html;
}
function setColor(k, v) {
  if (blocked()) { applyColors(); renderColors(); return; }
  if (!COLORS.some(([x]) => x === k) || (v !== null && !isHex(v))) return;
  write(setDoc(uref('meta', 'settings'), { couleurs: { [k]: v ? v.toLowerCase() : null } }, { merge: true }));
}
// Aperçu en direct pendant qu'on choisit, enregistrement quand le choix est fait.
$('#colors').addEventListener('input', e => { const i = e.target.closest('input[type="color"]'); if (i && isHex(i.value)) document.documentElement.style.setProperty('--c-' + i.dataset.k, i.value); });
$('#colors').addEventListener('change', e => { const i = e.target.closest('input[type="color"]'); if (i) setColor(i.dataset.k, i.value); });
function renderAllow() {
  if (!S.isAdmin) return;
  const me = ((S.user && S.user.email) || '').toLowerCase();
  $('#allow-list').innerHTML = S.allow.length ? S.allow.map(e => '<div class="allow-row"><span>' + esc(e) + '</span>' +
    (e === me ? '<span class="hint">toi</span>' : '<button class="btn ghost sm danger" data-act="allow-del" data-email="' + esc(e) + '">Retirer</button>') + '</div>').join('') : '<p class="empty">Aucun email pour l\'instant.</p>';
}
$('#allow-form').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#allow-email').value.trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) { toast('Email invalide.', true); return; }
  write(setDoc(doc(db, 'allowlist', v), { addedAt: serverTimestamp() }), v + ' peut maintenant utiliser P-Flow');
  $('#allow-email').value = '';
});
// Demandes d'accès (administrateur) : bandeau en haut de l'appli et liste dans Réglages → Administration.
const armedReq = new Set();
function reqActions(r) {
  return '<span class="acts"><button class="btn primary sm" data-act="req-accept" data-email="' + esc(r.email) + '">Accepter</button>' +
    '<button class="btn ghost sm danger" data-act="req-refuse" data-email="' + esc(r.email) + '">' + (armedReq.has(r.email) ? 'Confirmer le refus' : 'Refuser') + '</button></span>';
}
function renderReqBanner() {
  const b = $('#req-banner');
  if (!S.isAdmin || !S.demandes.length) { b.hidden = true; return; }
  const r = S.demandes[0], more = S.demandes.length - 1;
  b.innerHTML = '<span>' + ico('bell') + ' <b>' + esc(r.email) + '</b> demande l\'accès' + (r.message ? ' : « ' + esc(r.message) + ' »' : '') +
    (more ? ' <button class="link" data-act="sub-admin">et ' + plural(more, 'autre demande') + '</button>' : '') + '</span>' + reqActions(r);
  b.hidden = false;
}
function renderReqList() {
  if (!S.isAdmin) return;
  $('#req-list').innerHTML = S.demandes.length ? S.demandes.map(r => '<div class="req-row"><span class="who"><b>' + esc(r.email) + '</b>' +
    (r.nom ? '<small>' + esc(r.nom) + '</small>' : '') + (r.message ? '<small>« ' + esc(r.message) + ' »</small>' : '') + (tsMs(r.at) ? '<small>le ' + esc(dateFr(tsMs(r.at))) + '</small>' : '') + '</span>' + reqActions(r) + '</div>').join('')
    : '<p class="empty">Aucune demande en attente. Partage P-Flow : la personne pourra demander l\'accès depuis l\'appli.</p>';
}
function calc() {
  if (!isPro()) return;
  const y = NOW.getFullYear(), rate = rateFor(y);
  $('#c-rate').textContent = 'Avec ton taux ' + y + ' : ' + pctf(rate);
  const b = parseAmount($('#c-brut').value);
  $('#c-out1').innerHTML = b > 0 ? 'URSSAF <b>' + MINUS + eur(b * rate / 100) + '</b> · il te reste <b>' + eur(b - r2(b * rate / 100)) + '</b>' : 'Tape un montant brut pour voir ce qu\'il te reste.';
  const o = parseAmount($('#c-obj').value), th = parseAmount($('#c-th').value);
  if (o > 0 && rate < 100) {
    const ca = r2(o / (1 - rate / 100));
    $('#c-out2').innerHTML = 'Il faut facturer <b>' + eur(ca) + '</b> par mois' + (th > 0 ? ', soit <b>' + NUM.format(Math.ceil(ca / th * 10) / 10) + ' h</b> à ' + eur(th) + '/h' : '') + '.';
  } else $('#c-out2').textContent = 'Indique le net que tu veux te verser.';
}
['#c-brut', '#c-obj', '#c-th'].forEach(id => $(id).addEventListener('input', calc));
$('#rates').addEventListener('change', e => {
  const inp = e.target.closest('input[data-year]'); if (!inp) return;
  const v = parseAmount(inp.value), y = inp.dataset.year;
  if (blocked()) { inp.value = NUM.format(rateFor(+y)); return; }
  if (!(v >= 0 && v < 100)) { toast('Taux invalide : écris par exemple 21,2', true); inp.value = NUM.format(rateFor(+y)); return; }
  write(setDoc(uref('meta', 'settings'), { taux: { [y]: v } }, { merge: true }), 'Taux ' + y + ' : ' + pctf(v));
});
$('#rates').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
$('#ep-toggle').addEventListener('change', e => {
  if (blocked()) { e.target.checked = epOn(); return; }
  write(setDoc(uref('meta', 'settings'), { epargne: e.target.checked }, { merge: true }), e.target.checked ? 'Épargne activée' : 'Épargne désactivée');
});
$('#noir-toggle').addEventListener('change', e => setAppearance('noir', e.target.checked));
$('#effets-toggle').addEventListener('change', e => setAppearance('effets', e.target.checked ? 'reduits' : 'normal'));

/* ---------- export (version PC) ---------- */
function exportCsv() {
  if (!ready()) return;
  const y = S.entriesYear;
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const n = v => String(r2(v)).replace('.', ',');
  const lines = ['Date;Mois;Type;Libellé;Montant;Soumis URSSAF;URSSAF;Fixe'];
  for (let i = 1; i <= 12; i++) {
    const d = monthData(ym(y, i)); if (d.m > CUR) break;
    for (const it of d.items) {
      const rev = it.type === 'revenu', u = rev && it.urssaf && isPro();
      lines.push([it.kind === 'entry' ? it.date : d.m + '-01', d.m, rev ? 'Revenu' : 'Dépense', q(it.label), n(it.amount), u ? 'oui' : 'non', n(u ? it.amount * d.rate / 100 : 0), it.kind === 'entry' ? 'non' : it.kind === 'rec' ? 'oui' : FREQ_LABEL[it.freq]].join(';'));
    }
    for (const it of d.eps.concat(d.autos)) {
      lines.push([it.kind === 'ep' ? it.date : d.m + '-01', d.m, it.op === 'retrait' ? 'Épargne reprise' : 'Épargne', q(it.label), n(it.amount), 'non', '0', it.kind === 'auto' ? FREQ_LABEL[it.freq] : 'non'].join(';'));
    }
  }
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'p-flow-' + y + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- fenêtres : ouverture et fermeture animées ---------- */
const isWide = () => window.innerWidth >= 700;
function openLayer(back, sheet) {
  back.getAnimations && back.getAnimations().forEach(a => a.cancel());
  sheet.getAnimations && sheet.getAnimations().forEach(a => a.cancel());
  delete back.dataset.closing; back.style.pointerEvents = '';
  back.hidden = false;
  anim(back, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
  return anim(sheet, isWide()
    ? [{ transform: 'translateY(18px) scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 }]
    : [{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: isWide() ? 300 : 380, easing: SPRING });
}
function closeLayer(back, sheet) {
  if (back.hidden || back.dataset.closing) return;
  const a = anim(sheet, isWide()
    ? [{ transform: 'none', opacity: 1 }, { transform: 'translateY(12px) scale(.98)', opacity: 0 }]
    : [{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 220, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  if (!a) { back.hidden = true; return; }
  const b = anim(back, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
  back.dataset.closing = '1'; back.style.pointerEvents = 'none';
  a.finished.then(() => {
    if (!back.dataset.closing) return; // rouverte entre-temps
    back.hidden = true; delete back.dataset.closing; back.style.pointerEvents = '';
    a.cancel(); if (b) b.cancel();
  }, () => {});
}
const layerOpen = back => !back.hidden && !back.dataset.closing;

/* ---------- panneau d'information (nouveautés, détails) ---------- */
const pbg = $('#panel-bg'), panel = $('#panel');
let panelFocus = null;
function openPanel(title, html) {
  panelFocus = document.activeElement;
  $('#panel-title').textContent = title;
  $('#panel-body').innerHTML = html;
  panel.scrollTop = 0;
  openLayer(pbg, panel);
  document.body.style.overflow = 'hidden';
  panel.focus({ preventScroll: true }); // pour le clavier et les lecteurs d'écran, sans cadre de focus sur le bouton
}
function closePanel() {
  closeLayer(pbg, panel);
  if (!layerOpen(bg)) document.body.style.overflow = '';
  if (panelFocus && panelFocus.focus && document.contains(panelFocus)) { try { panelFocus.focus(); } catch (e) { /* ignoré */ } }
}
$('#panel-close').addEventListener('click', closePanel);
pbg.addEventListener('click', e => { if (e.target === pbg) closePanel(); });
function openCompte(key) {
  const c = comptes().find(x => x.key === key); if (!c) return;
  const evs = S.epargne.filter(e => norm(e.label) === key).map(e => Object.assign({ kind: 'ep' }, e)).sort(byDate);
  const autos = S.periodiques.filter(p => p.type === 'epargne' && norm(p.label) === key);
  openPanel(c.label, '<p class="hint">Solde estimé</p><p class="uc-amount">' + eur(c.solde) + '</p>' +
    (autos.length ? '<h3>Versements automatiques</h3><div>' + autos.map(p => '<button class="row" data-act="edit-per" data-id="' + esc(p.id) + '"><span class="row-ico ep">' + ico('epargne') + '</span><span class="row-main"><span class="row-label">' + esc(cap(FREQ_LABEL[p.freq])) + '</span><span class="row-meta">' + esc('depuis ' + mShort(p.start) + (p.end ? ' · jusqu\'à ' + mShort(p.end) : '')) + '</span></span><span class="row-amt ep">' + eur(p.amount) + '</span></button>').join('') + '</div>' : '') +
    '<h3>Opérations</h3>' + (evs.length ? '<div>' + evs.map(e => rowHtml(e, 0)).join('') + '</div>' : '<p class="empty">Aucune opération notée.</p>'));
}
function openTop(k) {
  if (!YD) return;
  if (k === '__autres') {
    const rest = YD.top.slice(6);
    openPanel('Autres dépenses', '<div>' + rest.map(c => '<button class="top-row" data-act="top-open" data-k="' + esc(c.k) + '"><span class="l">' + esc(c.label) + '</span><span class="a">' + eur(c.total) + '</span></button>').join('') + '</div>');
    return;
  }
  const c = YD.top.find(x => x.k === k); if (!c) return;
  const items = c.items.slice().sort((a, b) => b.m.localeCompare(a.m) || byDate(a, b));
  const rowFor = it => it.kind === 'entry' ? rowHtml(it, 0)
    : '<button class="row" data-act="' + ROW_ACT[it.kind] + '" data-id="' + esc(it.id) + '"><span class="row-ico">' + ico('out') + '</span><span class="row-main"><span class="row-label">' + esc(it.label) + '<span class="tag">fixe</span></span><span class="row-meta">' + esc(cap(mLabel(it.m))) + '</span></span><span class="row-amt">' + MINUS + eur(it.amount) + '</span></button>';
  openPanel(c.label, '<p class="hint">' + S.year + ' · ' + plural(items.length, 'opération') + '</p><p class="uc-amount">' + eur(c.total) + '</p>' +
    '<div>' + items.map(rowFor).join('') + '</div>');
}

/* ---------- nouveautés après une mise à jour ---------- */
function mdToHtml(md) {
  const out = []; let inList = false;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  for (const raw of String(md).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const m = line.match(/^(\s*)- (.*)$/);
    if (m) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li' + (m[1].length >= 2 ? ' class="sub"' : '') + '>' + inline(m[2]) + '</li>'); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (/^##\s/.test(line) || line.trim() === '---') continue; // le titre est dans l'en-tête du panneau
    if (/^###\s/.test(line)) out.push('<h3>' + inline(line.replace(/^###\s*/, '')) + '</h3>');
    else if (line.trim()) out.push('<p>' + inline(line) + '</p>');
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
const verLabel = v => String(v || '').replace(/-beta/, ' bêta').replace(/-test(\d+)$/, ' (test $1)');
function showNews() {
  if (!NOTES) { toast('Pas de notes pour cette version.'); return; }
  openPanel('Nouveautés · P-Flow ' + verLabel(NOTES_VERSION), mdToHtml(NOTES));
  lsSet('pf-nouveautes', NOTES_VERSION);
}
// Une seule fois par appareil, à la première ouverture d'une nouvelle version (pas après la création du compte).
function maybeNews() {
  if (!NOTES || !NOTES_VERSION || !S.ready || lsGet('pf-nouveautes') === NOTES_VERSION) return;
  if (S.justOnboarded || !$('#s-onboard').hidden) { lsSet('pf-nouveautes', NOTES_VERSION); return; }
  if (layerOpen(bg)) { setTimeout(maybeNews, 1500); return; }
  showNews();
}

/* ---------- feuille d'ajout / modification ---------- */
const F = { mode: 'new', type: 'depense', op: 'depot', freq: 'once', orig: null, ctx: CUR, armed: false };
const bg = $('#sheet-bg'), form = $('#sheet');
const COL = { 'edit-entry': 'entries', 'edit-rec': 'recurring', 'edit-per': 'periodiques', 'edit-ep': 'epargne' };
let lastFocus = null;
const isFixe = () => F.mode === 'edit-rec' || F.mode === 'edit-per';
function openSheet(o) {
  if (blocked()) return;
  if (layerOpen(pbg)) closePanel();
  lastFocus = document.activeElement;
  F.mode = o.mode; F.armed = false; F.ctx = S.view === 'mois' ? S.month : CUR;
  $('#f-error').textContent = '';
  let start = F.ctx;
  if (o.mode === 'new') {
    F.orig = null;
    F.type = o.type === 'epargne' && !epOn() ? 'depense' : (o.type || 'depense');
    F.op = 'depot'; F.freq = o.rec ? 'mois' : 'once';
    $('#f-amount').value = ''; $('#f-label').value = '';
    $('#f-date').value = F.ctx === CUR ? TODAY : F.ctx + '-01';
    $('#f-urssaf').checked = true;
  } else {
    const it = { 'edit-entry': S.entries, 'edit-rec': S.recurring, 'edit-per': S.periodiques, 'edit-ep': S.epargne }[o.mode].find(x => x.id === o.id);
    if (!it) return;
    F.orig = it;
    if (o.mode === 'edit-ep') { F.type = 'epargne'; F.op = OPS.includes(it.op) ? it.op : 'depot'; F.freq = 'once'; }
    else if (o.mode === 'edit-per') { F.type = PER_TYPES.includes(it.type) ? it.type : 'depense'; F.op = 'depot'; F.freq = FREQ[it.freq] ? it.freq : 'mois'; }
    else { F.type = it.type === 'revenu' ? 'revenu' : 'depense'; F.op = 'depot'; F.freq = o.mode === 'edit-rec' ? 'mois' : 'once'; }
    $('#f-amount').value = amountStr(it.amount);
    $('#f-label').value = it.label || '';
    $('#f-date').value = DATE_RE.test(it.date || '') ? it.date : TODAY;
    if (isFixe() && YM_RE.test(it.start || '')) start = it.start;
    $('#f-urssaf').checked = !!it.urssaf;
  }
  $('#f-start').innerHTML = monthOptions(start, [start, F.ctx]);
  $('#f-start').value = start;
  const opening = openLayer(bg, form);
  document.body.style.overflow = 'hidden';
  syncSheet();
  // Le clavier s'ouvre une fois la fenêtre en place : les deux mouvements ne se gênent pas.
  const focusAmount = () => { if (!layerOpen(bg)) return; const a = $('#f-amount'); a.focus({ preventScroll: true }); if (o.mode !== 'new') a.select(); };
  if (opening) opening.finished.then(focusAmount, () => {}); else setTimeout(focusAmount, 60);
}
function closeSheet() {
  closeSuggest();
  closeLayer(bg, form);
  if (!layerOpen(pbg)) document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (e) { /* ignoré */ } }
}
function syncSheet() {
  const t = F.type, isNew = F.mode === 'new', ep = t === 'epargne', rev = t === 'revenu', fixe = isFixe();
  // Type : les trois en ajout (épargne si elle est suivie) ; en modification, on reste dans la même famille.
  const showEp = isNew && epOn();
  $('#type-seg').hidden = F.mode === 'edit-ep' || (F.mode === 'edit-per' && ep);
  $('#type-seg [data-type="epargne"]').hidden = !showEp;
  $('#type-seg').classList.toggle('seg3', showEp);
  $$('#type-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === t)));
  $('#op-seg').hidden = !ep || F.mode === 'edit-per';
  $$('#op-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.op === F.op)));
  // Fréquence : une fois / chaque mois / trimestre / année (dépôts d'épargne seulement pour l'épargne).
  if (ep && F.op !== 'depot') F.freq = 'once';
  const canFreq = (isNew || fixe) && !(ep && F.op !== 'depot');
  if (fixe && F.freq === 'once') F.freq = 'mois';
  $('#f-freq-field').hidden = !canFreq;
  $('#freq-seg [data-f="once"]').hidden = fixe;
  $('#freq-seg').classList.toggle('seg3', fixe); $('#freq-seg').classList.toggle('seg4', !fixe);
  // Fixe avec une date de fin : sa fréquence ne change pas (sinon il pourrait repartir ou perdre une échéance).
  const ended = fixe && !!F.orig.end;
  $$('#freq-seg button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.f === F.freq)); b.disabled = !!ended && b.dataset.f !== F.freq; });
  const once = F.freq === 'once';
  $('#f-date-field').hidden = !once; $('#f-start-field').hidden = once;
  $('#f-start-label').textContent = 'À partir de';
  $('#f-label-label').textContent = ep ? 'Sur quel compte' : 'À quoi ça correspond';
  $('#f-label').placeholder = ep ? 'Livret A, PEL, tirelire…' : rev ? 'Salaire, facture client, CAF…' : 'Loyer, courses, plein d\'essence…';
  $('#f-amount-label').textContent = ep && F.op === 'solde' ? 'Montant actuellement sur le compte' : 'Montant';
  $('#f-urssaf-row').hidden = !rev || !isPro();
  $('#sheet-title').textContent = isNew ? (ep ? 'Épargne' : once ? 'Nouvelle opération' : 'Nouveau fixe')
    : fixe ? (ep ? 'Modifier le versement' : 'Modifier le fixe') : F.mode === 'edit-ep' ? 'Modifier l\'épargne' : 'Modifier';
  const del = $('#f-delete'); del.hidden = isNew; del.classList.remove('armed'); del.textContent = 'Supprimer'; F.armed = false;
  const stop = $('#f-stop');
  if (fixe) { stop.hidden = false; stop.textContent = F.orig.end ? 'Reprendre' : 'Arrêter après ' + MONTHS[pYM(F.ctx).m - 1]; }
  else stop.hidden = true;
  const hint = $('#f-hint');
  const hints = [];
  // Scission seulement si le mois de départ ne change pas (sinon le fixe est réécrit avec le nouveau départ).
  if (fixe && F.orig.start < F.ctx && (!F.orig.end || F.orig.end >= F.ctx) && $('#f-start').value === F.orig.start) {
    const ns = F.mode === 'edit-rec' && F.freq === 'mois' ? F.ctx : firstDue(F.orig.start, F.freq, F.ctx);
    hints.push('Un nouveau montant compte à partir de ' + mLabel(ns) + '. Les mois d\'avant gardent ' + eur(F.orig.amount) + '.');
  }
  if (ended) hints.push('Ce fixe a une date de fin : pour changer sa fréquence, touche d\'abord « Reprendre ».');
  hint.hidden = !hints.length; hint.textContent = hints.join(' ');
  updatePreview();
  // Les suggestions dépendent du type (dépense, revenu ou compte d'épargne).
  if (document.activeElement === $('#f-label')) suggest(); else closeSuggest();
}
function cycleTxt(start, freq) {
  if (freq === 'annee') return 'chaque ' + MONTHS[pYM(start).m - 1];
  if (freq !== 'trimestre') return '';
  const m0 = pYM(start).m - 1;
  return [0, 3, 6, 9].map(k => MS[(m0 + k) % 12]).join(', ');
}
function updatePreview() {
  const p = $('#f-preview'), a = parseAmount($('#f-amount').value);
  const once = F.freq === 'once';
  const date = once ? ($('#f-date').value || TODAY) : (($('#f-start').value || CUR) + '-01');
  const m = date.slice(0, 7), y = +date.slice(0, 4) || NOW.getFullYear();
  const say = h => { p.hidden = false; p.innerHTML = h; };
  if (F.type === 'revenu' && isPro() && $('#f-urssaf').checked) {
    const rate = rateFor(y);
    say(a > 0 ? 'URSSAF ' + pctf(rate) + ' : <b>' + MINUS + eur(a * rate / 100) + '</b> · il te reste <b>' + eur(a - r2(a * rate / 100)) + '</b>' : 'Tape le montant brut : le net et la part URSSAF s\'affichent ici.');
  } else if (F.type === 'epargne') {
    if (F.op === 'solde') say('Le compte est fixé à ce montant au ' + esc(DATE_RE.test(date) ? dLabel(date) : '') + ' ; ce que tu mets de côté ou reprends ensuite s\'y ajoute. Le reste du mois ne change pas.');
    else if (F.op === 'retrait') say('Repris : ce montant redonne de l\'argent au reste ' + esc(deMois(pYM(m).m - 1)) + '.');
    else if (once) say('Mis de côté : ce montant est retiré du reste ' + esc(deMois(pYM(m).m - 1)) + '.');
    else say('Mis de côté automatiquement ' + FREQ_LABEL[F.freq] + ' à partir de ' + esc(mLabel(m)) + (cycleTxt(m, F.freq) ? ' (' + esc(cycleTxt(m, F.freq)) + ')' : '') + '.');
  } else if (!once && F.mode === 'new') {
    say('Compté automatiquement ' + FREQ_LABEL[F.freq] + ' à partir de ' + esc(mLabel(m)) + (cycleTxt(m, F.freq) ? ' (' + esc(cycleTxt(m, F.freq)) + ')' : '') + ', en entier le mois où il tombe.');
  } else p.hidden = true;
}
$('#type-seg').addEventListener('click', e => { const b = e.target.closest('button[data-type]'); if (!b) return; F.type = b.dataset.type; if (F.type === 'epargne' && F.freq !== 'once' && F.op !== 'depot') F.op = 'depot'; syncSheet(); });
$('#op-seg').addEventListener('click', e => { const b = e.target.closest('button[data-op]'); if (!b) return; F.op = b.dataset.op; syncSheet(); });
$('#freq-seg').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b || b.disabled) return; F.freq = b.dataset.f; syncSheet(); });
['#f-amount', '#f-date'].forEach(id => $(id).addEventListener('input', updatePreview));
$('#f-start').addEventListener('change', () => { if (isFixe()) syncSheet(); else updatePreview(); });
$('#f-urssaf').addEventListener('change', updatePreview);
$('#sheet-close').addEventListener('click', closeSheet);
bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (layerOpen(pbg)) closePanel(); else if (layerOpen(bg)) closeSheet(); else if (S.bubble != null) hideBubble();
});

form.addEventListener('submit', e => {
  e.preventDefault();
  if (blocked()) { closeSheet(); return; }
  const err = m => { $('#f-error').textContent = m; };
  const amount = parseAmount($('#f-amount').value);
  const label = $('#f-label').value.trim().replace(/\s+/g, ' ');
  const once = F.freq === 'once', ep = F.type === 'epargne';
  const date = $('#f-date').value, startSel = $('#f-start').value;
  if (!(amount > 0 || (ep && F.op === 'solde' && amount === 0))) return err('Indique un montant supérieur à 0, par exemple 12,50.');
  if (!label) return err(ep ? 'Indique le compte, par exemple Livret A.' : 'Écris à quoi correspond ce montant.');
  if (once && !DATE_RE.test(date)) return err('Choisis une date.');
  if (!once && !YM_RE.test(startSel)) return err('Choisis le mois de départ.');
  const type = F.type, urssaf = type === 'revenu' && isPro() && $('#f-urssaf').checked;
  const mode = F.mode, o = F.orig, cm = F.ctx, f = F.freq;
  const month = once ? date.slice(0, 7) : startSel;
  closeSheet();
  if (mode === 'new') {
    if (ep && once) write(addDoc(ucol('epargne'), { op: F.op, label, amount, date, month, createdAt: Date.now() }), F.op === 'solde' ? 'Solde enregistré' : F.op === 'retrait' ? 'Retrait noté' : 'Mis de côté');
    else if (ep) write(addDoc(ucol('periodiques'), { type: 'epargne', label, amount, urssaf: false, freq: f, start: month, end: null, createdAt: Date.now() }), 'Versement automatique ajouté à partir de ' + mLabel(month));
    else if (once) write(addDoc(ucol('entries'), { type, label, amount, urssaf, date, month, createdAt: Date.now() }), (S.view === 'mois' && month !== S.month) ? 'Enregistré en ' + mLabel(month) : 'Enregistré');
    else if (f === 'mois') write(addDoc(ucol('recurring'), { type, label, amount, urssaf, start: month, end: null, createdAt: Date.now() }), 'Fixe ajouté à partir de ' + mLabel(month));
    else write(addDoc(ucol('periodiques'), { type, label, amount, urssaf, freq: f, start: month, end: null, createdAt: Date.now() }), 'Fixe ajouté : ' + FREQ_LABEL[f] + ' à partir de ' + mLabel(month));
  } else if (mode === 'edit-entry') {
    // Repartir du document lu : un champ ajouté par une version plus récente n'est jamais effacé.
    write(setDoc(doc(ucol('entries'), o.id), Object.assign(plain(o), { type, label, amount, urssaf, date, month, createdAt: o.createdAt || Date.now() })), 'Modifié');
  } else if (mode === 'edit-ep') {
    write(setDoc(doc(ucol('epargne'), o.id), Object.assign(plain(o), { op: F.op, label, amount, date, month, createdAt: o.createdAt || Date.now() })), 'Modifié');
  } else {
    saveFixe(o, COL[mode], f, { type, label, amount, urssaf, start: startSel }, cm);
  }
});
// Fixes (chaque mois → `recurring` ; trimestre, année et épargne automatique → `periodiques`).
// Un changement de montant ou de fréquence en cours de route (mois de départ inchangé) garde le passé :
// l'ancien s'arrête au mois d'avant et un nouveau prend le relais (même principe qu'avant le patch 2).
// Changer le mois de départ réécrit le fixe avec ce nouveau départ (comme avant le patch 2). Les deux écritures partent
// ensemble (writeBatch) : jamais l'une sans l'autre. Aucun fixe n'est supprimé par une modification.
function saveFixe(o, src, f, vals, cm) {
  const dst = vals.type === 'epargne' || f !== 'mois' ? 'periodiques' : 'recurring';
  const moved = dst !== src;
  const past = o.start < cm;
  const started = past && (!o.end || o.end >= cm);
  const startChanged = vals.start !== o.start;
  const valueChanged = vals.amount !== o.amount || vals.type !== o.type || vals.urssaf !== !!o.urssaf || (src === 'periodiques' && f !== o.freq);
  const withFreq = (d, ff) => { if (dst === 'periodiques') d.freq = ff; else delete d.freq; return d; };
  const oldRef = doc(ucol(src), o.id);
  if (!moved) {
    if (!startChanged && valueChanged && started) {
      const ns = dst === 'recurring' ? cm : firstDue(o.start, f, cm);
      const b = writeBatch(db);
      b.set(oldRef, Object.assign(plain(o), { label: vals.label, end: addM(cm, -1) }));
      b.set(doc(ucol(dst)), withFreq(Object.assign(plain(o), vals, { start: ns, end: o.end || null, createdAt: Date.now() }), f));
      write(b.commit(), 'Nouveau montant à partir de ' + mLabel(ns));
    } else {
      write(setDoc(oldRef, withFreq(Object.assign(plain(o), vals), f)), 'Modifié');
    }
    return;
  }
  // Changement de collection (chaque mois ↔ trimestre / année) : le passé reste compté tel qu'il était.
  // L'ancien document est gardé et arrêté juste avant le nouveau (s'il n'avait pas commencé, il s'arrête
  // avant son début : il ne compte plus nulle part, mais rien n'est effacé).
  const ns = started ? firstDue(vals.start, f, cm) : vals.start;
  const nd = withFreq(Object.assign(plain(o), vals, { start: ns, end: o.end && o.end >= ns ? o.end : null, createdAt: Date.now() }), f);
  const b = writeBatch(db);
  b.set(doc(ucol(dst)), nd);
  b.set(oldRef, Object.assign(plain(o), { end: past ? addM(cm, -1) : addM(o.start, -1) }));
  write(b.commit(), 'Modifié : ' + FREQ_LABEL[f] + ' à partir de ' + mLabel(ns));
}
$('#f-delete').addEventListener('click', () => {
  if (blocked()) { closeSheet(); return; }
  const b = $('#f-delete');
  if (!F.armed) { F.armed = true; b.classList.add('armed'); b.textContent = isFixe() ? 'Confirmer : retirer de tous les mois' : 'Confirmer la suppression'; return; }
  const o = F.orig, mode = F.mode; closeSheet();
  write(deleteDoc(doc(ucol(COL[mode]), o.id)), mode === 'edit-rec' || mode === 'edit-per' ? 'Fixe supprimé' : 'Supprimé');
});
$('#f-stop').addEventListener('click', () => {
  if (blocked()) { closeSheet(); return; }
  const o = F.orig, cm = F.ctx, col = COL[F.mode]; closeSheet();
  if (o.end) write(setDoc(doc(ucol(col), o.id), Object.assign(plain(o), { end: null })), 'Repris');
  else { const end = cm < o.start ? o.start : cm; write(setDoc(doc(ucol(col), o.id), Object.assign(plain(o), { end })), 'Arrêté après ' + mLabel(end)); }
});

/* ---------- suggestions de libellés (dans la fenêtre, sous le champ) ---------- */
const fold = s => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const lab = $('#f-label'), sug = $('#f-suggest');
const SG = { items: [], active: -1 };
// Libellés déjà utilisés pour ce type (ou comptes d'épargne), du plus fréquent au plus récent.
function labelPool(type) {
  const m = new Map();
  const add = it => {
    const k = fold(it.label); if (!k) return;
    const c = m.get(k) || { l: it.label, n: 0, t: 0 };
    c.n++; c.t = Math.max(c.t, Number(it.createdAt) || 0); m.set(k, c);
  };
  if (type === 'epargne') { S.epargne.forEach(add); S.periodiques.filter(p => p.type === 'epargne').forEach(add); }
  else { [S.entries, S.recurring, S.periodiques].forEach(arr => arr.filter(it => it.type === type).forEach(add)); }
  return Array.from(m.values()).sort((a, b) => b.n - a.n || b.t - a.t);
}
function suggest() {
  const q = fold(lab.value), pool = labelPool(F.type);
  let list;
  if (!q) list = pool.slice(0, 5);
  else {
    const starts = [], has = [];
    for (const c of pool) { const k = fold(c.l); if (k === q) continue; if (k.startsWith(q)) starts.push(c); else if (k.includes(q)) has.push(c); }
    list = starts.concat(has).slice(0, 6);
  }
  SG.items = list.map(c => c.l); SG.active = -1;
  if (!list.length) { closeSuggest(); return; }
  sug.innerHTML = list.map((c, i) => '<li role="option" id="sg-' + i + '" data-i="' + i + '" aria-selected="false">' + esc(c.l) + '</li>').join('');
  sug.hidden = false;
  lab.setAttribute('aria-expanded', 'true'); lab.removeAttribute('aria-activedescendant');
  keepFocusVisible();
}
function closeSuggest() {
  sug.hidden = true; sug.innerHTML = ''; SG.items = []; SG.active = -1;
  lab.setAttribute('aria-expanded', 'false'); lab.removeAttribute('aria-activedescendant');
}
function moveSuggest(d) {
  const n = SG.items.length; if (!n) return;
  const m = n + 1; // positions : -1 (le texte tapé), puis 0 … n-1
  SG.active = (((SG.active + 1 + d) % m) + m) % m - 1;
  $$('li', sug).forEach((li, i) => { li.classList.toggle('on', i === SG.active); li.setAttribute('aria-selected', String(i === SG.active)); });
  if (SG.active >= 0) { lab.setAttribute('aria-activedescendant', 'sg-' + SG.active); $('#sg-' + SG.active).scrollIntoView({ block: 'nearest' }); }
  else lab.removeAttribute('aria-activedescendant');
}
function pickSuggest(i) {
  const v = SG.items[i]; if (v == null) return;
  lab.value = v; closeSuggest();
}
lab.addEventListener('focus', suggest);
lab.addEventListener('input', suggest);
lab.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== lab) closeSuggest(); }, 150));
lab.addEventListener('keydown', e => {
  if (sug.hidden) { if (e.key === 'ArrowDown') { e.preventDefault(); suggest(); } return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
  else if (e.key === 'Enter' && SG.active >= 0) { e.preventDefault(); pickSuggest(SG.active); }
  else if (e.key === 'Escape') { e.stopPropagation(); closeSuggest(); }
});
// Garder le clavier ouvert quand on touche une suggestion ; le choix se fait au « clic »
// (un glissement pour faire défiler la fenêtre ne choisit rien).
sug.addEventListener('pointerdown', e => e.preventDefault());
sug.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) pickSuggest(+li.dataset.i); });

/* ---------- clavier : la fenêtre d'ajout reste au-dessus ---------- */
// Android 15 et plus (affichage bord à bord) : le clavier recouvre l'appli sans la redimensionner ;
// sa hauteur vient du module natif Keyboard. Navigateurs (iPhone, Chrome) : visualViewport.
// On garde le plus grand des deux recouvrements, jamais leur somme : c'est le même clavier.
const KB = { native: 0, base: window.innerHeight, cover: -1, open: null, top: -1 };
const isEditable = el => !!el && ((el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file)$/.test(el.type)) || el.tagName === 'TEXTAREA' || el.isContentEditable);
function kbUpdate() {
  const vv = window.visualViewport;
  let top = 0, cover = 0;
  // Seulement avec un champ actif (pas de clavier sans champ), et pas pendant un zoom au doigt.
  if (vv && vv.scale < 1.01 && isEditable(document.activeElement)) {
    top = Math.max(0, vv.offsetTop);
    cover = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
  }
  // Hauteur annoncée par Android, moins ce que la fenêtre a déjà perdu (anciens Android qui la redimensionnent).
  const nat = Math.max(0, KB.native - Math.max(0, KB.base - window.innerHeight));
  cover = Math.round(Math.max(cover, nat));
  if (cover < 2) cover = 0;
  const root = document.documentElement, topPx = Math.round(top);
  if (cover !== KB.cover) root.style.setProperty('--kb', cover + 'px');
  if (topPx !== KB.top) root.style.setProperty('--kb-top', topPx + 'px');
  const open = cover > 0 || (KB.base - window.innerHeight > 120 && isEditable(document.activeElement));
  if (open !== KB.open) root.classList.toggle('kb-open', open);
  const changed = cover !== KB.cover || open !== KB.open;
  KB.cover = cover; KB.open = open; KB.top = topPx;
  if (open && changed) keepFocusVisible();
}
// Fait apparaître le champ actif (et ses suggestions) au-dessus du clavier.
function keepFocusVisible() {
  requestAnimationFrame(() => {
    const a = document.activeElement;
    if (!isEditable(a)) return;
    a.scrollIntoView({ block: 'nearest' });
    if (a === lab && !sug.hidden) sug.scrollIntoView({ block: 'nearest' });
  });
}
window.addEventListener('resize', () => {
  if (!KB.native && !isEditable(document.activeElement)) KB.base = window.innerHeight;
  kbUpdate();
  positionIndicator(false);
  if (S.bubble != null) hideBubble();
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', kbUpdate);
  window.visualViewport.addEventListener('scroll', kbUpdate);
}
document.addEventListener('focusin', e => {
  if (!isEditable(e.target)) return;
  setTimeout(() => { kbUpdate(); if (document.documentElement.classList.contains('kb-open')) keepFocusVisible(); }, 60);
});
if (isNative) {
  const setKb = h => { KB.native = Math.max(0, Number(h) || 0); kbUpdate(); };
  try {
    Keyboard.addListener('keyboardWillShow', i => setKb(i && i.keyboardHeight)).catch(() => {});
    Keyboard.addListener('keyboardDidShow', i => setKb(i && i.keyboardHeight)).catch(() => {});
    Keyboard.addListener('keyboardWillHide', () => setKb(0)).catch(() => {});
    Keyboard.addListener('keyboardDidHide', () => setKb(0)).catch(() => {});
  } catch (e) { /* module clavier absent : on garde le calcul par visualViewport */ }
}
// Tests uniquement (tests/vite.config.js) : simule le clavier d'Android 15, qui recouvre sans redimensionner.
/* global __PFLOW_TEST__ */
if (typeof __PFLOW_TEST__ !== 'undefined') window.__pfSetKeyboard = h => { KB.native = h; kbUpdate(); };

/* ---------- navigation ---------- */
let indX = null;
// Surlignage de l'onglet actif : il glisse et s'étire légèrement pendant le mouvement (effet « liquide »).
function positionIndicator(animate) {
  const bar = $('.tabbar'), ind = $('.tab-ind');
  if (!bar || !ind || !bar.offsetWidth) return;
  const b = $('.tabbar [data-view="' + S.view + '"]'); if (!b) return;
  const x = b.offsetLeft, w = b.offsetWidth;
  ind.style.width = w + 'px';
  ind.style.transform = 'translateX(' + x + 'px)';
  if (animate && indX != null && indX !== x) {
    anim(ind, [
      { transform: 'translateX(' + indX + 'px) scaleX(1)' },
      { transform: 'translateX(' + ((indX + x) / 2) + 'px) scaleX(1.32)', offset: 0.45 },
      { transform: 'translateX(' + x + 'px) scaleX(1)' },
    ], { duration: 460, easing: 'cubic-bezier(.3,.8,.25,1)' });
  }
  indX = x;
}
function setView(v) {
  const from = VIEWS.indexOf(S.view), to = VIEWS.indexOf(v);
  if (S.view === v && !(v === 'reglages' && S.sub)) { window.scrollTo({ top: 0, behavior: motionOK() ? 'smooth' : 'auto' }); return; }
  S.view = v; S.sub = null; S.deferYear = v === 'annee';
  try { history.replaceState(null, '', '#' + v); } catch (e) { /* ignoré */ }
  hideBubble();
  $('.tabbar').dataset.view = v;
  positionIndicator(true); // avant le rendu : la position des onglets se lit sans recalcul de la page
  ensureYearSub(); render(); window.scrollTo(0, 0);
  slideIn($('#v-' + v), to >= from ? 1 : -1);
}
function setSub(name, dir) {
  S.sub = name;
  render(); window.scrollTo(0, 0);
  slideIn(name ? $('#sub-' + name) : $('#set-home'), dir, 40);
}
function setMonth(m, dir) {
  S.month = m; S.year = pYM(m).y; ensureYearSub(); render();
  if (dir) { slideIn($('#v-mois .month-grid'), dir, 36); slideIn($('#ctx h1'), dir, 14); }
}
function setYear(y, dir) {
  S.year = y; S.deferYear = !!dir; ensureYearSub(); render();
  if (dir) { slideIn($('#v-annee'), dir, 30); slideIn($('#ctx h1'), dir, 14); }
}
// Glisser à gauche / à droite sur l'écran Mois pour changer de mois.
(function swipeMonths() {
  const host = $('#v-mois');
  let x0 = 0, y0 = 0, dx = 0, on = false, lock = null, pid = null, until = 0;
  const grid = () => $('#v-mois .month-grid');
  host.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !S.ready || e.target.closest('input,select,textarea,label,#sim')) return;
    on = true; lock = null; dx = 0; x0 = e.clientX; y0 = e.clientY; pid = e.pointerId;
  });
  host.addEventListener('pointermove', e => {
    if (!on || e.pointerId !== pid) return;
    const ddx = e.clientX - x0, ddy = e.clientY - y0;
    if (lock === null) {
      if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.4) lock = 'x';
      else if (Math.abs(ddy) > 12) { on = false; return; }
    }
    if (lock === 'x') { dx = ddx; if (motionOK()) grid().style.transform = 'translateX(' + (dx * 0.35) + 'px)'; }
  });
  const end = cancel => e => {
    if (!on || e.pointerId !== pid) return;
    on = false;
    if (lock !== 'x') return;
    until = Date.now() + 400; // le « clic » qui suit le glissement ne doit rien ouvrir
    const g = grid(), off = dx * 0.35; g.style.transform = '';
    if (!cancel && Math.abs(dx) > 70) setMonth(addM(S.month, dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    else anim(g, [{ transform: 'translateX(' + off + 'px)' }, { transform: 'none' }], { duration: 300, easing: SPRING });
  };
  host.addEventListener('pointerup', end(false));
  host.addEventListener('pointercancel', end(true));
  host.addEventListener('click', e => { if (Date.now() < until) { e.stopPropagation(); e.preventDefault(); } }, true);
})();
const armedAllow = new Set();
document.addEventListener('click', e => {
  if (S.bubble != null && !e.target.closest('#bubble, #chart .bar-g')) hideBubble();
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act;
  if (a === 'logout') { logout(); return; }
  if (!S.ready) return;
  if (a === 'view') setView(t.dataset.view);
  else if (a === 'prev-month') setMonth(addM(S.month, -1), -1);
  else if (a === 'next-month') setMonth(addM(S.month, 1), 1);
  else if (a === 'today') setMonth(CUR, S.month < CUR ? 1 : -1);
  else if (a === 'prev-year') setYear(S.year - 1, -1);
  else if (a === 'next-year') setYear(S.year + 1, 1);
  else if (a === 'add') openSheet({ mode: 'new', rec: S.view === 'fixes' });
  else if (a === 'add-type') openSheet({ mode: 'new', type: t.dataset.type });
  else if (a === 'edit-entry' || a === 'edit-rec' || a === 'edit-per' || a === 'edit-ep') openSheet({ mode: a, id: t.dataset.id });
  else if (a === 'toggle-fixed') { S.showFixed = !S.showFixed; lsSet('pf-showFixed', S.showFixed ? '1' : '0'); renderMois(); }
  else if (a === 'toggle-ended') { S.showEnded = !S.showEnded; renderFixes(); }
  else if (a === 'group-toggle') { S.grouped = !S.grouped; lsSet('pf-groupe', S.grouped ? '1' : '0'); renderMois(); }
  else if (a === 'grp-open') { const k = t.dataset.k; if (S.openGroups.has(k)) S.openGroups.delete(k); else S.openGroups.add(k); renderMois(); }
  else if (a === 'urssaf-toggle') { S.ucOpen = !S.ucOpen; renderMois(); if (S.ucOpen) riseIn($('#urssaf-card')); }
  else if (a === 'sim-toggle') { S.simOpen = !S.simOpen; renderMois(); if (S.simOpen) { riseIn($('#sim')); $('#c-brut').focus(); } }
  else if (a === 'ep-offer') {
    if (blocked()) return;
    const yes = t.dataset.v === '1';
    write(setDoc(uref('meta', 'settings'), { epargne: yes }, { merge: true }), yes ? 'Épargne activée : ajoute-la avec le bouton Épargne' : 'C\'est noté. Tu pourras l\'activer dans Réglages → Mon compte.');
  } else if (a === 'compte-open') openCompte(t.dataset.k);
  else if (a === 'bar') showBubble(+t.dataset.i);
  else if (a === 'top-open') openTop(t.dataset.k);
  else if (a === 'goto-month') { hideBubble(); S.month = t.dataset.month; S.year = pYM(S.month).y; setView('mois'); }
  else if (a === 'sub') setSub(t.dataset.sub, 1);
  else if (a === 'sub-back') setSub(null, -1);
  else if (a === 'sub-admin') { if (S.view !== 'reglages') setView('reglages'); setSub('admin', 1); }
  else if (a === 'theme') setAppearance('theme', t.dataset.t);
  else if (a === 'texte') setAppearance('texte', t.dataset.t);
  else if (a === 'news') showNews();
  else if (a === 'redo-setup') { if (!blocked()) openOnboarding(true); }
  else if (a === 'export') exportCsv();
  // mises à jour
  else if (a === 'upd-check') checkUpdate(true);
  else if (a === 'upd-download') { if (isNative) downloadUpdate(); }
  else if (a === 'upd-install') installUpdate();
  else if (a === 'upd-reload') location.reload();
  // sauvegardes (Drive : driveBackup / driveList / drivePick demandent le jeton dès le clic)
  else if (a === 'backup-export') exportBackup();
  else if (a === 'drive-connect' || a === 'drive-now' || a === 'drive-due') driveBackup(true, false);
  else if (a === 'drive-list') driveList();
  else if (a === 'drive-list-close') { BK.list = null; renderBackup(); }
  else if (a === 'drive-pick') drivePick(t.dataset.id);
  else if (a === 'drive-freq') {
    const f = t.dataset.f;
    if (BK_FREQ[f] && f !== bkCfg().frequence && !blocked()) write(setDoc(uref('meta', 'settings'), { sauvegarde: { frequence: f } }, { merge: true }));
  } else if (a === 'drive-stop') {
    if (!t.classList.contains('armed')) { t.classList.add('armed'); t.textContent = 'Confirmer : arrêter les copies sur Drive'; return; }
    if (!blocked()) write(setDoc(uref('meta', 'settings'), { sauvegarde: { drive: false } }, { merge: true }), 'Copies sur Google Drive arrêtées (les anciennes restent sur ton Drive)');
    BK.due = false; BK.list = null;
  } else if (a === 'restore-go') { if (BK.plan) applyRestore(BK.plan); }
  else if (a === 'restore-cancel') { BK.plan = null; renderBackup(); }
  else if (a === 'color-open') { S.colorOpen = S.colorOpen === t.dataset.k ? null : t.dataset.k; renderColors(); }
  else if (a === 'color-set') setColor(t.dataset.k, t.dataset.c);
  else if (a === 'color-reset') setColor(t.dataset.k, null);
  else if (a === 'colors-reset') {
    if (!Object.keys(S.settings.couleurs).length || blocked()) return;
    write(setDoc(uref('meta', 'settings'), { couleurs: Object.fromEntries(COLORS.map(([k]) => [k, null])) }, { merge: true }), 'Couleurs par défaut');
  }
  else if (a === 'period') { if (S.settings.periodicite !== t.dataset.p && !blocked()) write(setDoc(uref('meta', 'settings'), { periodicite: t.dataset.p }, { merge: true }), t.dataset.p === 'mensuelle' ? 'Déclaration mensuelle' : 'Déclaration trimestrielle'); }
  else if (a === 'profile') {
    const pro = t.dataset.pro === '1';
    if (pro === isPro() || blocked()) return;
    const patch = { pro };
    if (pro && !Object.keys(S.settings.taux).length) patch.taux = { [String(NOW.getFullYear())]: 21.2 };
    write(setDoc(uref('meta', 'settings'), patch, { merge: true }), pro ? 'Profil auto-entrepreneur : vérifie ton taux URSSAF' : 'Profil particulier');
  } else if (a === 'allow-del') {
    const em = t.dataset.email;
    if (!armedAllow.has(em)) { armedAllow.add(em); t.textContent = 'Confirmer'; t.classList.add('armed'); return; }
    armedAllow.delete(em);
    write(deleteDoc(doc(db, 'allowlist', em)), em + ' retiré');
  } else if (a === 'req-accept') {
    const em = t.dataset.email; if (!S.isAdmin || !em) return;
    armedReq.delete(em);
    write(Promise.all([setDoc(doc(db, 'allowlist', em), { addedAt: serverTimestamp() }), deleteDoc(doc(db, 'demandes', em))]), em + ' peut maintenant utiliser P-Flow');
  } else if (a === 'req-refuse') {
    const em = t.dataset.email; if (!S.isAdmin || !em) return;
    if (!armedReq.has(em)) { armedReq.add(em); renderReqBanner(); renderReqList(); return; }
    armedReq.delete(em);
    write(deleteDoc(doc(db, 'demandes', em)), 'Demande de ' + em + ' refusée');
  }
});
// PC : flèches gauche / droite pour changer de mois (ou d'année).
document.addEventListener('keydown', e => {
  const ae = document.activeElement;
  if (!S.ready || $('#app').hidden || layerOpen(bg) || layerOpen(pbg) || isEditable(ae) || (ae && ae.tagName === 'SELECT') || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const d = e.key === 'ArrowLeft' ? -1 : 1;
  if (S.view === 'mois') setMonth(addM(S.month, d), d);
  else if (S.view === 'annee') setYear(S.year + d, d);
});

let toastT = null;
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!isErr);
  if (t.hidden) { t.hidden = false; anim(t, [{ transform: 'translateX(-50%) translateY(12px)', opacity: 0 }, { transform: 'translateX(-50%)', opacity: 1 }], { duration: 260, easing: SPRING }); }
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2200);
}

/* ---------- appli Android : retour et mises à jour ---------- */
if (isNative) {
  CapApp.addListener('backButton', () => {
    if (layerOpen(pbg)) { closePanel(); return; }
    if (layerOpen(bg)) { closeSheet(); return; }
    if (!$('#s-onboard').hidden) {
      if (OB.step > 0) obGo(OB.step - 1);
      else if (OB.redo) { OB.redo = false; show('app'); render(); requestAnimationFrame(() => positionIndicator(false)); }
      else CapApp.exitApp();
      return;
    }
    if (S.ready && S.view === 'reglages' && S.sub) { setSub(null, -1); return; }
    if (S.ready && S.view !== 'mois') { setView('mois'); return; }
    CapApp.exitApp();
  });
}
/* ---------- mises à jour ---------- */
// Android : l'appli télécharge la nouvelle version en arrière-plan, puis propose de l'installer
// (Android demande toujours une confirmation). Navigateur : il suffit de recharger la page.
// Vérification automatique à l'ouverture, selon l'intervalle choisi (réglage propre à chaque appareil).
const UPD_FREQ = { ouverture: 0, jour: 864e5, semaine: 7 * 864e5, jamais: Infinity };
const UPD = { state: 'idle', info: null, pct: 0, msg: '', manual: false };
const updAuto = () => { const v = lsGet('pf-maj-auto'); return v in UPD_FREQ ? v : 'jour'; };
function maybeAutoUpdate() {
  const f = UPD_FREQ[updAuto()];
  if (f === Infinity || UPD.state === 'checking' || UPD.state === 'downloading' || UPD.state === 'ready') return;
  if (Date.now() - (Number(lsGet('pf-maj-last')) || 0) < f) return;
  checkUpdate(false);
}
async function checkUpdate(manual) {
  if (!PAGES_URL) return;
  UPD.manual = manual; UPD.state = 'checking'; UPD.msg = ''; renderUpdate();
  try {
    const res = await fetch(PAGES_URL + 'version.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const v = await res.json();
    lsSet('pf-maj-last', String(Date.now()));
    if (Number(v.build) > Number(APP_BUILD)) {
      UPD.info = v; UPD.state = 'available';
      renderUpdate();
      if (isNative) downloadUpdate(); // en arrière-plan
      return;
    }
    UPD.state = 'none';
  } catch (e) {
    UPD.state = manual ? 'error' : 'idle';
    UPD.msg = 'Impossible de vérifier : vérifie ta connexion internet.';
  }
  renderUpdate();
}
async function downloadUpdate() {
  if (!UPD.info || UPD.state === 'downloading') return;
  UPD.state = 'downloading'; UPD.pct = 0; UPD.msg = ''; renderUpdate();
  let h = null;
  try {
    h = await PFlowNative.addListener('downloadProgress', p => { UPD.pct = Number(p && p.percent) || 0; renderUpdate(); });
    await PFlowNative.downloadApk({ url: UPD.info.apk });
    UPD.state = 'ready';
  } catch (e) {
    UPD.state = 'error'; UPD.msg = 'Le téléchargement n\'a pas abouti.';
  } finally {
    if (h) { try { h.remove(); } catch (e) { /* ignoré */ } }
    renderUpdate();
  }
}
async function installUpdate() {
  try {
    const r = await PFlowNative.installApk();
    UPD.msg = r && r.needsPermission
      ? 'Android demande d\'autoriser P-Flow à installer des applis : active l\'option, reviens ici, puis touche « Installer ».'
      : '';
  } catch (e) {
    UPD.state = 'error'; UPD.msg = (e && e.message) || 'L\'installation n\'a pas pu démarrer.';
  }
  renderUpdate();
}
function renderUpdate() {
  const v = UPD.info ? verLabel(UPD.info.version) : '';
  const fallback = UPD.info && UPD.info.apk ? ' <a href="' + esc(UPD.info.apk) + '" target="_blank" rel="noopener">Télécharger depuis le navigateur</a>' : '';
  // Bandeau en haut de l'appli
  const b = $('#update');
  let bh = '';
  if (UPD.state === 'available' && !isNative) bh = '<span>P-Flow ' + esc(v) + ' est disponible.</span><button class="link" data-act="upd-reload">Recharger</button>';
  else if (UPD.state === 'downloading') bh = '<span>Téléchargement de P-Flow ' + esc(v) + '… ' + UPD.pct + ' %</span>';
  else if (UPD.state === 'ready') bh = '<span>P-Flow ' + esc(v) + ' est prêt à être installé.</span><button class="link" data-act="upd-install">Installer</button>';
  else if (UPD.state === 'error' && UPD.info) bh = '<span>' + esc(UPD.msg) + '</span><span><button class="link" data-act="upd-download">Réessayer</button>' + fallback + '</span>';
  if (UPD.state === 'ready' && UPD.msg) bh += '<span class="hint" style="flex-basis:100%">' + esc(UPD.msg) + '</span>';
  b.innerHTML = bh; b.hidden = !bh;
  const badge = $('#sh-apropos-badge'); if (badge) badge.hidden = !(UPD.state === 'available' || UPD.state === 'ready');
  // Réglages → À propos → Mises à jour
  const st = $('#upd-status');
  if (!st) return;
  let t = '', act = '';
  if (UPD.state === 'checking') t = 'Recherche d\'une mise à jour…';
  else if (UPD.state === 'none') t = UPD.manual ? 'Tu as la dernière version.' : '';
  else if (UPD.state === 'available') { t = 'P-Flow ' + v + ' est disponible.'; act = isNative ? '<button class="btn primary" data-act="upd-download">Télécharger</button>' : '<button class="btn primary" data-act="upd-reload">Recharger la page</button>'; }
  else if (UPD.state === 'downloading') t = 'Téléchargement de P-Flow ' + v + '… ' + UPD.pct + ' %';
  else if (UPD.state === 'ready') { t = 'P-Flow ' + v + ' est téléchargé.' + (UPD.msg ? ' ' + UPD.msg : ''); act = '<button class="btn primary" data-act="upd-install">Installer</button>'; }
  else if (UPD.state === 'error') { t = UPD.msg; if (UPD.info && isNative) act = '<button class="btn ghost" data-act="upd-download">Réessayer</button>'; }
  st.textContent = t; st.hidden = !t;
  $('#upd-actions').innerHTML = act;
  $('#upd-check').disabled = UPD.state === 'checking' || UPD.state === 'downloading';
  const sel = $('#upd-auto'); if (sel.value !== updAuto()) sel.value = updAuto();
  const pr = $('#upd-progress'); pr.hidden = UPD.state !== 'downloading'; pr.value = UPD.pct;
}
$('#upd-auto').addEventListener('change', e => { if (e.target.value in UPD_FREQ) lsSet('pf-maj-auto', e.target.value); });
if (isNative) CapApp.addListener('appStateChange', st => { if (st && st.isActive && S.ready) maybeAutoUpdate(); });

/* ---------- sauvegardes : fichier et Google Drive ---------- */
// Une sauvegarde contient tout le compte. La restaurer remet seulement ce qui manque :
// rien n'est écrasé ni supprimé (CLAUDE.md, règle n°1). Les réglages ne sont pas modifiés.
// Format 2 (patch 2) : ajoute `periodiques` et `epargne` ; les sauvegardes format 1 se restaurent toujours.
const BK = { busy: false, status: '', err: false, due: false, triedAuto: false, list: null, plan: null, link: null };
const BK_COLS = ['entries', 'recurring', 'periodiques', 'epargne'];
// Déconnexion / changement de compte : on oublie tout (jeton Google, restauration en attente…).
function resetBackupState() {
  Object.assign(BK, { busy: false, status: '', err: false, due: false, triedAuto: false, list: null, plan: null, link: null });
  Drive.resetAccount();
}
const bkCfg = () => (S.settings && S.settings.sauvegarde) || { drive: false, frequence: 'mensuelle', derniere: 0 };
const plainVal = v => (v && typeof v.toMillis === 'function' ? v.toMillis() : v);
const cleanDoc = d => { const o = {}; for (const k of Object.keys(d)) o[k] = plainVal(d[k]); return o; };
const pad2 = n => String(n).padStart(2, '0');
function bkName() {
  const d = new Date();
  return 'p-flow-sauvegarde-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '-' + pad2(d.getHours()) + 'h' + pad2(d.getMinutes()) + '.json';
}
// Toujours lu sur le serveur, jamais dans le cache de l'appareil (qui peut être incomplet hors ligne) :
// une sauvegarde partielle, ou une restauration qui croirait manquants des documents existants, est impossible.
const OFFLINE_MSG = 'Il faut être connecté à internet pour cette action.';
async function fromServer(p) {
  try { return await p; } catch (e) { throw (e && (e.code === 'unavailable' || e.code === 'failed-precondition')) ? new Error(OFFLINE_MSG) : e; }
}
async function buildBackup() {
  const [st, ...cols] = await fromServer(Promise.all([getDocFromServer(uref('meta', 'settings'))].concat(BK_COLS.map(c => getDocsFromServer(ucol(c))))));
  const o = { app: 'P-Flow', format: 2, dataVersion: DATA_VERSION, appVersion: RAW_VERSION, exportedAt: new Date().toISOString(), settings: st.exists() ? cleanDoc(st.data()) : null };
  BK_COLS.forEach((c, i) => { o[c] = cols[i].docs.map(d => Object.assign({ id: d.id }, cleanDoc(d.data()))); });
  return o;
}
function validItem(it, kind) {
  if (!it || typeof it !== 'object' || !ID_RE.test(String(it.id))) return false;
  const amt = typeof it.amount === 'number' && isFinite(it.amount);
  if (typeof it.label !== 'string' || !it.label.trim()) return false;
  if (kind === 'epargne') return OPS.includes(it.op) && amt && (it.amount > 0 || (it.op === 'solde' && it.amount === 0)) && DATE_RE.test(it.date) && YM_RE.test(it.month);
  if (!amt || !(it.amount > 0)) return false;
  if (kind === 'periodiques') return PER_TYPES.includes(it.type) && !!FREQ[it.freq] && YM_RE.test(it.start) && (it.end == null || YM_RE.test(it.end));
  if (it.type !== 'revenu' && it.type !== 'depense') return false;
  if (kind === 'entries') return DATE_RE.test(it.date) && YM_RE.test(it.month);
  return YM_RE.test(it.start) && (it.end == null || YM_RE.test(it.end));
}
function parseBackup(text) {
  let o = null;
  try { o = JSON.parse(text); } catch (e) { /* pas du JSON */ }
  if (!o || o.app !== 'P-Flow' || !Array.isArray(o.entries) || !Array.isArray(o.recurring)) throw new Error('Ce fichier n\'est pas une sauvegarde P-Flow.');
  if ((Number(o.dataVersion) || 1) > DATA_VERSION) throw new Error('Cette sauvegarde vient d\'une version plus récente de P-Flow : mets l\'appli à jour pour la restaurer.');
  const r = { when: o.exportedAt, invalid: 0 };
  for (const c of BK_COLS) {
    const arr = Array.isArray(o[c]) ? o[c] : [];
    r[c] = arr.filter(x => validItem(x, c));
    r.invalid += arr.length - r[c].length;
  }
  return r;
}
async function planRestore(bk, source) {
  const snaps = await fromServer(Promise.all(BK_COLS.map(c => getDocsFromServer(ucol(c)))));
  const plan = { source, when: bk.when, invalid: bk.invalid, total: {}, add: {} };
  BK_COLS.forEach((c, i) => { const have = new Set(snaps[i].docs.map(d => d.id)); plan.total[c] = bk[c].length; plan.add[c] = bk[c].filter(x => !have.has(x.id)); });
  return plan;
}
// « 4 opérations, 3 fixes et 2 opérations d'épargne » (les catégories vides sont omises, sauf les deux premières).
function countTxt(n) {
  const parts = [plural(n.entries, 'opération'), plural(n.recurring + n.periodiques, 'fixe')];
  if (n.epargne) parts.push(plural(n.epargne, 'opération') + ' d\'épargne');
  return joinFr(parts);
}
function applyRestore(plan) {
  if (blocked()) return;
  const strip = o => { const c = {}; for (const k of Object.keys(o)) if (k !== 'id' && !k.startsWith('__')) c[k] = o[k]; return c; };
  const jobs = [];
  for (const c of BK_COLS) for (const x of plan.add[c]) jobs.push(setDoc(doc(ucol(c), x.id), strip(x)));
  const n = Object.fromEntries(BK_COLS.map(c => [c, plan.add[c].length]));
  write(Promise.all(jobs), countTxt(n) + ' remis');
  BK.plan = null; renderBackup();
}
function fmtWhen(iso) {
  const d = new Date(iso); if (isNaN(d)) return 'date inconnue';
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' à ' + pad2(d.getHours()) + 'h' + pad2(d.getMinutes());
}
function setBk(msg, err, keepLink) { BK.status = msg || ''; BK.err = !!err; if (!keepLink) BK.link = null; renderBackup(); }
function driveErr(e) { return (e && e.message) || 'Google Drive est indisponible pour le moment.'; }

// Fichier : exporter (téléchargement sur PC, « Enregistrer sous » sur Android).
async function exportBackup() {
  if (!ready()) return;
  setBk('Préparation de la sauvegarde…');
  try {
    const text = JSON.stringify(await buildBackup(), null, 1), name = bkName();
    if (isNative) {
      await PFlowNative.saveFile({ name, data: text, mime: 'application/json' });
    } else {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      // Si le navigateur n'a pas lancé le téléchargement (iPhone notamment), un lien reste proposé une minute.
      BK.link = { url, name };
      setTimeout(() => { URL.revokeObjectURL(url); if (BK.link && BK.link.url === url) { BK.link = null; renderBackup(); } }, 60000);
      setBk('Sauvegarde prête : ' + name, false, true);
      return;
    }
    setBk('Sauvegarde enregistrée : ' + name);
  } catch (e) {
    setBk(e && e.code === 'CANCELED' ? '' : (e && e.message === OFFLINE_MSG ? OFFLINE_MSG : 'La sauvegarde n\'a pas pu être enregistrée.'), !(e && e.code === 'CANCELED'));
  }
}
// Fichier : importer (le fichier choisi est seulement lu, puis on montre ce qui sera remis).
$('#import-file').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (blocked()) return;
  setBk('Lecture du fichier…');
  try {
    if (f.size > 20e6) throw new Error('Ce fichier est trop gros pour être une sauvegarde P-Flow.');
    BK.plan = await planRestore(parseBackup(await f.text()), 'fichier');
    setBk('');
  } catch (x) { BK.plan = null; setBk(x.message || 'Ce fichier n\'a pas pu être lu.', true); }
});

// Google Drive. ATTENTION : dans un clic, appeler driveToken() avant tout « await » (fenêtre Google).
const driveToken = interactive => Drive.getToken({ native: isNative, plugin: PFlowNative, interactive, hint: S.user && S.user.email });
async function driveBackup(interactive, auto) {
  if (BK.busy || !ready()) return false;
  if (S.readOnly) { if (!auto) blocked(); return false; }
  BK.busy = true;
  const tok = driveToken(interactive); // tout de suite : garde le geste de l'utilisateur
  if (!auto) setBk('Sauvegarde sur Google Drive…');
  try {
    await tok;
    const f = await Drive.upload(bkName(), JSON.stringify(await buildBackup()));
    write(setDoc(uref('meta', 'settings'), { sauvegarde: { drive: true, frequence: bkCfg().frequence, derniere: Date.now() } }, { merge: true }));
    BK.due = false; BK.list = null;
    setBk('Sauvegarde faite sur Google Drive' + (f && f.name ? ' : ' + f.name : '') + '.');
    if (auto) toast('Sauvegarde automatique faite sur Google Drive');
    return true;
  } catch (e) {
    if (auto) { BK.due = true; BK.status = ''; } else {
      setBk(driveErr(e), true);
      if (S.view !== 'reglages') toast(driveErr(e), true); // lancé depuis le bandeau : le message doit se voir
    }
    return false;
  } finally { BK.busy = false; renderBackup(); }
}
function maybeAutoBackup() {
  if (BK.triedAuto || !S.settingsServer || !ready()) return; // réessayé à chaque affichage tant que tout n'est pas chargé
  const c = bkCfg();
  if (!c.drive || S.readOnly) return;
  BK.triedAuto = true;
  if (Date.now() - c.derniere < BK_FREQ[c.frequence] * 864e5) { BK.due = false; renderBackup(); return; }
  if (isNative) driveBackup(false, true); // sans fenêtre si l'accès est déjà accordé
  else { BK.due = true; Drive.prepareWeb(S.user && S.user.email).catch(() => {}); renderBackup(); }
}
async function driveList() {
  if (BK.busy) return;
  BK.busy = true;
  const tok = driveToken(true);
  setBk('Recherche de tes sauvegardes sur Google Drive…');
  try {
    await tok;
    BK.list = await Drive.list(); BK.plan = null;
    setBk(BK.list.length ? '' : 'Aucune sauvegarde dans ton Google Drive pour l\'instant.');
  } catch (e) { setBk(driveErr(e), true); } finally { BK.busy = false; renderBackup(); }
}
async function drivePick(id) {
  if (BK.busy || blocked()) return;
  BK.busy = true;
  const tok = driveToken(true);
  setBk('Lecture de la sauvegarde…');
  try {
    await tok;
    BK.plan = await planRestore(parseBackup(await Drive.download(id)), 'Google Drive');
    BK.list = null; setBk('');
  } catch (e) { setBk(driveErr(e), true); } finally { BK.busy = false; renderBackup(); }
}
function renderBackup() {
  const box = $('#drive-box'); if (!box || !S.settings) return;
  const c = bkCfg();
  if (!isNative) Drive.prepareWeb(S.user && S.user.email).catch(() => {});
  let h;
  if (!c.drive) {
    h = '<p class="hint">Copie automatique de tes données dans ton Google Drive, dans un dossier « P-Flow Sauvegardes ». P-Flow ne voit que les fichiers qu\'il crée, rien d\'autre de ton Drive.</p>' +
      '<div><button class="btn ghost" data-act="drive-connect"' + (BK.busy ? ' disabled' : '') + '>Connecter Google Drive</button></div>';
  } else {
    h = '<div class="meta-line"><span>Dernière copie sur Drive</span><b>' + (c.derniere ? esc(fmtWhen(c.derniere)) : 'pas encore') + '</b></div>' +
      '<div class="seg seg3" role="group" aria-label="Fréquence des copies">' +
      [['hebdomadaire', 'Chaque semaine'], ['mensuelle', 'Chaque mois'], ['annuelle', 'Chaque année']].map(([k, l]) => '<button type="button" data-act="drive-freq" data-f="' + k + '" aria-pressed="' + (c.frequence === k) + '">' + l + '</button>').join('') + '</div>' +
      '<div class="btn-row"><button class="btn ghost" data-act="drive-now"' + (BK.busy ? ' disabled' : '') + '>Sauvegarder maintenant</button>' +
      '<button class="btn ghost" data-act="drive-list"' + (BK.busy ? ' disabled' : '') + '>Restaurer depuis Drive</button></div>' +
      '<div><button class="link" data-act="drive-stop">Arrêter les copies sur Drive</button></div>';
  }
  if (box.innerHTML !== h) box.innerHTML = h;
  const st = $('#backup-status');
  st.innerHTML = esc(BK.status) + (BK.link && !BK.err ? ' <a href="' + BK.link.url + '" download="' + esc(BK.link.name) + '">Si le téléchargement n\'a pas commencé, touche ici.</a>' : '');
  st.hidden = !BK.status; st.classList.toggle('err', BK.err);
  // Liste des sauvegardes Drive
  const l = $('#drive-list');
  l.hidden = !(BK.list && BK.list.length);
  l.innerHTML = BK.list && BK.list.length ? '<p class="h3">Choisis une sauvegarde</p>' + BK.list.map(f => '<button class="row" data-act="drive-pick" data-id="' + esc(f.id) + '"><span class="row-main"><span class="row-label">' + esc(fmtWhen(f.createdTime)) + '</span><span class="row-meta">' + esc(f.name) + '</span></span><span class="row-amt">' + (Number(f.size) ? Math.max(1, Math.round(f.size / 1024)) + ' Ko' : '') + '</span></button>').join('') + '<div><button class="link" data-act="drive-list-close">Fermer</button></div>' : '';
  // Confirmation de restauration
  const p = $('#restore-panel'), plan = BK.plan;
  p.hidden = !plan;
  if (plan) {
    const n = Object.fromEntries(BK_COLS.map(c => [c, plan.add[c].length])), total = Object.values(n).reduce((a, b) => a + b, 0);
    p.innerHTML = '<p><b>Sauvegarde du ' + esc(fmtWhen(plan.when)) + '</b> (' + esc(plan.source) + ')</p>' +
      '<p class="hint">Elle contient ' + countTxt(plan.total) + '.' + (plan.invalid ? ' ' + plural(plan.invalid, 'ligne illisible') + ' ignorée' + (plan.invalid > 1 ? 's' : '') + '.' : '') + '</p>' +
      (total ? '<p>À remettre dans ton compte : <b>' + countTxt(n) + '</b> qui manquent. Ce qui est déjà dans ton compte ne change pas, et rien n\'est supprimé.</p>' +
        '<div class="btn-row"><button class="btn primary" data-act="restore-go">Remettre ce qui manque</button><button class="btn ghost" data-act="restore-cancel">Annuler</button></div>'
        : '<p>Ton compte contient déjà tout ce qu\'il y a dans cette sauvegarde.</p><div><button class="btn ghost" data-act="restore-cancel">Fermer</button></div>');
  }
  // Bandeau « copie à faire » (navigateur, ou Android sans autorisation)
  const due = $('#backup-due');
  due.hidden = !(BK.due && c.drive && S.ready);
}

/* ---------- partage ---------- */
const LINKS = { apk: (PAGES_URL || location.href.split('#')[0].replace(/[^/]*$/, '')) + 'telecharger.html', web: PAGES_URL || location.href.split('#')[0] };
$('#share-apk').textContent = LINKS.apk;
$('#share-web').textContent = LINKS.web;
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  const txt = LINKS[b.dataset.copy];
  try { await navigator.clipboard.writeText(txt); toast('Lien copié'); }
  catch (x) { const el = $('#share-' + b.dataset.copy); const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
});

/* ---------- appli web (iPhone, PC) : fonctionnement hors ligne ---------- */
if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

applyAppearance();
setLoginMode('login');
