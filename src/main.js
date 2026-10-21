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
  collection, doc, query, where, onSnapshot, setDoc, addDoc, deleteDoc, getDoc, getDocFromServer, getDocsFromServer, serverTimestamp,
} from 'firebase/firestore';
import { registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth, db, isNative } from './firebase.js';
import * as Drive from './drive.js';

// Module natif de P-Flow (Android) : Drive, Enregistrer sous, mises à jour.
const PFlowNative = registerPlugin('PFlowNative');

/* global __APP_VERSION__, __APP_BUILD__, __PAGES_URL__ */
const RAW_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const APP_VERSION = RAW_VERSION.replace(/-beta/, ' bêta').replace(/-test(\d+)$/, ' (test $1)');
const APP_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '0';
const PAGES_URL = typeof __PAGES_URL__ !== 'undefined' ? __PAGES_URL__ : '';
// Version du format des données que cette appli sait lire et écrire (CLAUDE.md, règle n°1).
// Champ `dataVersion` de meta/settings, absent = 1. Ne monter qu'avec une conversion validée.
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
const pctf = n => NUM.format(n) + ' %';
const MINUS = '−';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MI = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const VIEWS = ['mois', 'fixes', 'annee', 'reglages'];
// Couleurs personnalisables : clé (variable CSS --c-<clé>), libellé, réservée au profil auto-entrepreneur.
const COLORS = [['brut', 'Revenus bruts', true], ['urssaf', 'URSSAF', true], ['net', 'Revenus nets', false], ['dep', 'Dépenses', false], ['reste', 'Reste', false]];
const PRESETS = [['#2453c4', 'Bleu'], ['#7da3ff', 'Bleu clair'], ['#0e9aa7', 'Turquoise'], ['#16845a', 'Vert'], ['#4dc48b', 'Vert clair'], ['#c2810c', 'Ambre'],
  ['#e4a940', 'Jaune'], ['#e0662e', 'Orange'], ['#c23b35', 'Rouge'], ['#d9488f', 'Rose'], ['#7a5af8', 'Violet'], ['#6a7d90', 'Gris']];
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
// Fréquences des copies automatiques sur Google Drive (en jours).
const BK_FREQ = { hebdomadaire: 7, mensuelle: 30, annuelle: 365 };
const pad = n => String(n).padStart(2, '0');
const NOW = new Date();
const CUR = NOW.getFullYear() + '-' + pad(NOW.getMonth() + 1);
const TODAY = CUR + '-' + pad(NOW.getDate());
const ym = (y, m) => y + '-' + pad(m);
const pYM = s => { const a = s.split('-'); return { y: +a[0], m: +a[1] }; };
const addM = (s, k) => { let { y, m } = pYM(s); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return ym(y, m); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const mLabel = s => { const { y, m } = pYM(s); return MONTHS[m - 1] + ' ' + y; };
const mShort = s => { const { y, m } = pYM(s); return MS[m - 1] + ' ' + y; };
const dLabel = d => { const p = d.split('-'); return (+p[2]) + ' ' + MS[+p[1] - 1]; };
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };

function parseAmount(s) {
  s = String(s == null ? '' : s).replace(/[\s  €%]/g, '').replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return r2(parseFloat(s));
}

if (isNative) document.body.classList.add('native');

/* ---------- écrans ---------- */
const SCREENS = ['s-boot', 's-login', 's-verify', 's-denied', 's-onboard', 'app'];
function show(id) { SCREENS.forEach(s => { $('#' + s).hidden = s !== id; }); }

/* ---------- état ---------- */
const S = {
  user: null, isAdmin: false, ready: false,
  view: 'mois', month: CUR, year: NOW.getFullYear(),
  entries: [], entriesYear: null, unsubEntries: null,
  recurring: [], settings: null, settingsExists: false, readOnly: false,
  loaded: { entries: false, recurring: false, settings: false },
  pend: { entries: false, recurring: false, settings: false },
  showFixed: lsGet('pf-showFixed') === '1', showEnded: false, colorOpen: null,
  unsubs: [], allow: [],
};
{ const h = (location.hash || '').slice(1); if (VIEWS.includes(h)) S.view = h; }

const ready = () => S.loaded.entries && S.loaded.recurring && S.loaded.settings;
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
  return { pro: !!d.pro, taux, periodicite: d.periodicite === 'trimestrielle' ? 'trimestrielle' : 'mensuelle', couleurs, sauvegarde };
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
function monthData(m) {
  const y = pYM(m).y;
  const ents = (S.entriesYear === y ? S.entries : []).filter(e => e.month === m).map(e => Object.assign({ kind: 'entry' }, e));
  const recs = S.recurring.filter(r => r.start && r.start <= m && (!r.end || r.end >= m)).map(r => Object.assign({ kind: 'rec' }, r));
  const items = ents.concat(recs);
  const rate = rateFor(y);
  let brut = 0, base = 0, dep = 0;
  for (const it of items) {
    const a = Number(it.amount) || 0;
    if (it.type === 'revenu') { brut += a; if (it.urssaf && isPro()) base += a; } else dep += a;
  }
  brut = r2(brut); base = r2(base); dep = r2(dep);
  const urssaf = r2(base * rate / 100);
  const net = r2(brut - urssaf);
  return { m, items, ents, recs, rate, brut, base, urssaf, net, dep, reste: r2(net - dep) };
}
function urssafPeriod(m) {
  const { y, m: mm } = pYM(m);
  if (S.settings.periodicite === 'trimestrielle') {
    const q = Math.floor((mm - 1) / 3);
    let total = 0, base = 0;
    for (const x of [1, 2, 3].map(k => ym(y, q * 3 + k))) { const d = monthData(x); total += d.urssaf; base += d.base; }
    const dl = [new Date(y, 3, 30), new Date(y, 6, 31), new Date(y, 9, 31), new Date(y + 1, 0, 31)][q];
    return { title: 'URSSAF du ' + ['1er', '2e', '3e', '4e'][q] + ' trimestre ' + y, sub: MS[q * 3] + ' → ' + MS[q * 3 + 2], total: r2(total), base: r2(base), dl };
  }
  const d = monthData(m);
  return { title: 'URSSAF de ' + MONTHS[mm - 1], sub: '', total: d.urssaf, base: d.base, dl: new Date(y, mm + 1, 0), rate: d.rate };
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
  stopData();
  if (isNative) { try { await FirebaseAuthentication.signOut(); } catch (e) { /* pas de session Google native */ } }
  try { await signOut(auth); } catch (e) { /* déjà déconnecté */ }
}

onAuthStateChanged(auth, user => {
  if (!user) { stopData(); S.user = null; setLoginMode('login'); show('s-login'); return; }
  routeUser(user);
});

async function routeUser(user) {
  S.user = user;
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
  if (!allowed) {
    $('#d-email').textContent = user.email || ''; $('#d-uid').textContent = user.uid; $('#d-mail').textContent = email;
    show('s-denied'); return;
  }
  lsSet(flag, '1');
  try { S.isAdmin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch (e) { S.isAdmin = lsGet('pf-admin-' + user.uid) === '1'; }
  lsSet('pf-admin-' + user.uid, S.isAdmin ? '1' : '0');
  startData();
}

/* ---------- données ---------- */
function stopData() {
  S.unsubs.forEach(u => { try { u(); } catch (e) { /* ignoré */ } });
  S.unsubs = [];
  if (S.unsubEntries) { try { S.unsubEntries(); } catch (e) { /* ignoré */ } }
  S.unsubEntries = null; S.entriesYear = null; S.entries = []; S.recurring = []; S.settings = null; S.allow = [];
  S.readOnly = false; S.settingsServer = false; $('#outdated').hidden = true; applyColors();
  resetBackupState();
  S.loaded = { entries: false, recurring: false, settings: false };
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
    if (!S.settingsExists) { openOnboarding(); return; }
    enterApp();
    // Copie Drive automatique : seulement sur des réglages confirmés par le serveur (date de la dernière copie à jour).
    if (!snap.metadata.fromCache) { S.settingsServer = true; maybeAutoBackup(); }
  }, dbError));
  S.unsubs.push(onSnapshot(ucol('recurring'), opts, snap => {
    S.recurring = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    S.pend.recurring = snap.metadata.hasPendingWrites;
    S.loaded.recurring = true; render();
  }, dbError));
  if (S.isAdmin) {
    S.unsubs.push(onSnapshot(collection(db, 'allowlist'), snap => {
      S.allow = snap.docs.map(d => d.id).sort(); renderAllow();
    }, () => {}));
  }
  ensureYearSub();
}
function enterApp() {
  if (!S.ready) { S.ready = true; show('app'); $('#admin-card').hidden = !S.isAdmin; maybeAutoUpdate(); }
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

/* ---------- premier démarrage ---------- */
let obPro = false, obPeriod = 'mensuelle';
function openOnboarding() { show('s-onboard'); }
$('#o-profile').addEventListener('click', e => {
  const b = e.target.closest('button[data-pro]'); if (!b) return;
  obPro = b.dataset.pro === '1';
  $$('#o-profile button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('#o-pro').hidden = !obPro;
});
$('#o-period').addEventListener('click', e => {
  const b = e.target.closest('button[data-p]'); if (!b) return;
  obPeriod = b.dataset.p;
  $$('#o-period button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
$('#onboard-form').addEventListener('submit', e => {
  e.preventDefault();
  const data = { pro: obPro, taux: {}, periodicite: obPeriod, createdAt: serverTimestamp() };
  if (obPro) {
    const r = parseAmount($('#o-rate').value);
    if (!(r > 0 && r < 100)) { $('#o-error').textContent = 'Indique ton taux URSSAF, par exemple 21,2.'; return; }
    data.taux[String(NOW.getFullYear())] = r;
  }
  S.view = 'fixes';
  write(setDoc(uref('meta', 'settings'), data), 'Bienvenue sur P-Flow');
});

/* ---------- rendu ---------- */
function render() {
  if (!S.ready) return;
  $$('.view').forEach(el => { el.hidden = el.id !== 'v-' + S.view; });
  $$('[data-act="view"]').forEach(b => { if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  renderCtx(); updateSync();
  if (S.view === 'mois') renderMois();
  else if (S.view === 'fixes') renderFixes();
  else if (S.view === 'annee') renderAnnee();
  else renderReglages();
  maybeAutoBackup();
}
function updateSync() {
  let s = 'connecting', t = 'Connexion…';
  const pending = S.pend.entries || S.pend.recurring || S.pend.settings;
  if (!navigator.onLine) { s = 'off'; t = pending ? 'Hors ligne · en attente d\'envoi' : 'Hors ligne'; }
  else if (pending) { s = 'pending'; t = 'Envoi…'; }
  else if (ready()) { s = 'ok'; t = 'Synchronisé'; }
  $$('.sync').forEach(el => { el.dataset.s = s; el.title = t; $('.txt', el).textContent = t; });
}
window.addEventListener('online', updateSync);
window.addEventListener('offline', updateSync);

const ico = (id, cls) => '<svg class="i' + (cls ? ' ' + cls : '') + '"><use href="#i-' + id + '"/></svg>';
function renderCtx() {
  const c = $('#ctx');
  if (S.view === 'mois') {
    c.innerHTML = '<button class="icon-btn" data-act="prev-month" aria-label="Mois précédent">' + ico('left') + '</button><h1>' + esc(cap(mLabel(S.month))) + '</h1><button class="icon-btn" data-act="next-month" aria-label="Mois suivant">' + ico('right') + '</button>';
  } else if (S.view === 'annee') {
    c.innerHTML = '<button class="icon-btn" data-act="prev-year" aria-label="Année précédente">' + ico('left') + '</button><h1>' + S.year + '</h1><button class="icon-btn" data-act="next-year" aria-label="Année suivante">' + ico('right') + '</button>';
  } else {
    c.innerHTML = '<h1 style="padding-left:4px">' + (S.view === 'fixes' ? 'Charges et revenus fixes' : 'Réglages') + '</h1>';
  }
}

function rowHtml(it, rate) {
  const isRev = it.type === 'revenu';
  const meta = [];
  if (it.kind === 'entry') meta.push(dLabel(it.date));
  if (isRev && isPro()) meta.push(it.urssaf ? 'URSSAF ' + MINUS + eur(it.amount * rate / 100) : 'sans URSSAF');
  const tag = it.kind === 'rec' ? '<span class="tag">fixe</span>' : '';
  return '<button class="row" data-act="' + (it.kind === 'rec' ? 'edit-rec' : 'edit-entry') + '" data-id="' + esc(it.id) + '">' +
    '<span class="row-main"><span class="row-label">' + esc(it.label) + tag + '</span>' +
    (meta.length ? '<span class="row-meta">' + esc(meta.join(' · ')) + '</span>' : '') + '</span>' +
    '<span class="row-amt' + (isRev ? ' in' : '') + '">' + (isRev ? '+' : MINUS) + eur(it.amount) + '</span></button>';
}
const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);
const sumOf = arr => r2(arr.reduce((a, i) => a + (Number(i.amount) || 0), 0));

function renderMois() {
  const m = S.month, ok = ready(), d = monthData(m), pro = isPro();
  const bt = $('#back-today');
  bt.hidden = m === CUR; bt.textContent = 'Revenir à ' + MONTHS[pYM(CUR).m - 1];
  const amt = $('#hero-amount');
  amt.textContent = ok ? eur(d.reste) : '…';
  amt.className = 'big' + (ok ? (d.reste < 0 ? ' neg' : ' pos') : '');
  $('#hero-sub').textContent = ok ? eur(d.net) + (pro ? ' de revenus nets, ' : ' de revenus, ') + eur(d.dep) + ' de dépenses' : 'Chargement…';

  const split = $('#split');
  const segs = [];
  if (d.dep <= d.net) segs.push(['s-urssaf', d.urssaf, 'URSSAF'], ['s-dep', d.dep, 'Dépenses'], ['s-reste', d.net - d.dep, 'Reste']);
  else segs.push(['s-urssaf', d.urssaf, 'URSSAF'], ['s-dep', d.net, 'Dépenses couvertes'], ['s-manque', d.dep - d.net, 'Manque']);
  const tot = segs.reduce((a, s) => a + Math.max(0, s[1]), 0);
  if (!ok || tot <= 0) { split.className = 'split empty-bar'; split.innerHTML = ''; }
  else {
    split.className = 'split';
    split.innerHTML = segs.filter(s => s[1] > 0.004).map(s => '<i class="' + s[0] + '" style="flex:' + (s[1] / tot).toFixed(4) + ' 1 0" title="' + esc(s[2] + ' : ' + eur(s[1])) + '"></i>').join('');
  }
  const L = pro ? [
    ['s-brut', 'Revenus bruts', d.brut], ['s-urssaf', 'URSSAF (' + pctf(d.rate) + ')', d.urssaf],
    ['s-net', 'Revenus nets', d.net], ['s-dep', 'Dépenses', d.dep],
  ] : [['s-net', 'Revenus', d.brut], ['s-dep', 'Dépenses', d.dep]];
  L.push([d.reste < 0 ? 's-manque' : 's-reste', d.reste < 0 ? 'Il manque' : 'Reste', Math.abs(d.reste)]);
  $('#legend').innerHTML = L.map(l => '<div><dt><i class="sw ' + (l[0] === 'none' ? 'none' : l[0]) + '"></i>' + esc(l[1]) + '</dt><dd>' + (ok ? eur(l[2]) : '…') + '</dd></div>').join('');

  if (pro) {
    const u = urssafPeriod(m);
    const past = u.dl < new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
    const soon = !past && u.total > 0 && (u.dl - NOW) < 15 * 864e5;
    const dlTxt = u.dl.getDate() + ' ' + MONTHS[u.dl.getMonth()] + ' ' + u.dl.getFullYear();
    $('#urssaf-card').innerHTML =
      '<div class="uc-head"><i class="sw s-urssaf"></i><h3>' + esc(u.title) + (u.sub ? ' · ' + esc(u.sub) : '') + '</h3></div>' +
      '<p class="uc-amount">' + (ok ? eur(u.total) : '…') + '</p>' +
      '<p class="hint">' + (ok ? (u.base > 0 ? 'Sur ' + eur(u.base) + " de chiffre d'affaires" + (u.rate != null ? ' à ' + pctf(u.rate) : '') : "Aucun chiffre d'affaires noté pour cette période.") : '') + '</p>' +
      '<p class="uc-due' + (soon ? ' late' : '') + '">' + (past ? 'Échéance passée : ' : 'À déclarer et payer au plus tard le ') + esc(dlTxt) + '</p>';
  }

  const lists = $('#lists');
  if (!ok) { lists.innerHTML = '<p class="empty">Chargement…</p>'; return; }
  const revs = d.items.filter(i => i.type === 'revenu').sort((a, b) => (a.kind === b.kind ? byDate(a, b) : (a.kind === 'entry' ? -1 : 1)));
  const depE = d.ents.filter(i => i.type === 'depense').sort(byDate);
  const depR = d.recs.filter(i => i.type === 'depense').sort((a, b) => b.amount - a.amount);
  let h = '';
  h += '<section class="group"><div class="group-head"><h3>Revenus</h3><span class="sum">' + (revs.length ? '+' + eur(sumOf(revs)) : '') + '</span></div>' +
    (revs.length ? revs.map(i => rowHtml(i, d.rate)).join('') : '<p class="empty">Aucun revenu noté pour ' + esc(mLabel(m)) + '. Ajoute-le avec <b>+</b> puis « Revenu ».</p>') + '</section>';
  h += '<section class="group"><div class="group-head"><h3>Dépenses du mois</h3><span class="sum">' + (depE.length ? MINUS + eur(sumOf(depE)) : '') + '</span></div>' +
    (depE.length ? depE.map(i => rowHtml(i, d.rate)).join('') : '<p class="empty">Aucune dépense notée. Ajoute-la avec <b>+</b> : tu écris toi-même à quoi elle correspond.</p>') + '</section>';
  if (depR.length) {
    h += '<section class="group"><button class="group-head" data-act="toggle-fixed" aria-expanded="' + S.showFixed + '"><span class="gh-left">' + ico('right', 'chev') + '<span class="h3">Charges fixes · ' + depR.length + '</span></span><span class="sum">' + MINUS + eur(sumOf(depR)) + '</span></button>' +
      (S.showFixed ? depR.map(i => rowHtml(i, d.rate)).join('') : '') + '</section>';
  }
  lists.innerHTML = h;
}

function renderFixes() {
  const ok = ready();
  const act = S.recurring.filter(r => r.start <= CUR && (!r.end || r.end >= CUR));
  const up = S.recurring.filter(r => r.start > CUR);
  const ended = S.recurring.filter(r => r.end && r.end < CUR);
  const dep = act.filter(r => r.type === 'depense'), rev = act.filter(r => r.type === 'revenu');
  $('#fix-totals').innerHTML =
    '<div><span>Charges fixes par mois</span><strong>' + (ok ? eur(sumOf(dep)) : '…') + '</strong></div>' +
    '<div><span>Revenus fixes par mois</span><strong>' + (ok ? eur(sumOf(rev)) : '…') + '</strong></div>' +
    '<div><span>Nombre</span><strong>' + (ok ? act.length : '…') + '</strong></div>';
  const list = $('#fix-list');
  if (!ok) { list.innerHTML = '<p class="empty">Chargement…</p>'; return; }
  const row = r => {
    const isRev = r.type === 'revenu';
    const meta = (r.start > CUR ? 'à partir de ' : 'depuis ') + mShort(r.start) + (r.end ? ' · jusqu\'à ' + mShort(r.end) : '') + (isRev && isPro() ? (r.urssaf ? ' · soumis URSSAF' : ' · sans URSSAF') : '');
    return '<button class="row" data-act="edit-rec" data-id="' + esc(r.id) + '"><span class="row-main"><span class="row-label">' + esc(r.label) + '</span><span class="row-meta">' + esc(meta) + '</span></span>' +
      '<span class="row-amt' + (isRev ? ' in' : '') + '">' + (isRev ? '+' : MINUS) + eur(r.amount) + '</span></button>';
  };
  const sortA = arr => arr.slice().sort((a, b) => b.amount - a.amount);
  let h = '';
  h += '<section class="group"><div class="group-head"><h3>Charges</h3><span class="sum">' + (dep.length ? MINUS + eur(sumOf(dep)) : '') + '</span></div>' + (dep.length ? sortA(dep).map(row).join('') : '<p class="empty">Aucune charge fixe pour l\'instant. Ajoute ton loyer, tes abonnements, tes crédits… avec « Ajouter un fixe ».</p>') + '</section>';
  if (rev.length) h += '<section class="group"><div class="group-head"><h3>Revenus</h3><span class="sum">+' + eur(sumOf(rev)) + '</span></div>' + sortA(rev).map(row).join('') + '</section>';
  if (up.length) h += '<section class="group"><div class="group-head"><h3>À venir</h3></div>' + sortA(up).map(row).join('') + '</section>';
  if (ended.length) h += '<section class="group"><button class="group-head" data-act="toggle-ended" aria-expanded="' + S.showEnded + '"><span class="gh-left">' + ico('right', 'chev') + '<span class="h3">Terminés · ' + ended.length + '</span></span></button>' + (S.showEnded ? sortA(ended).map(row).join('') : '') + '</section>';
  list.innerHTML = h;
}

function yearData(y) {
  const months = [];
  for (let i = 1; i <= 12; i++) { const d = monthData(ym(y, i)); d.fut = d.m > CUR; d.now = d.m === CUR; months.push(d); }
  const counted = months.filter(d => !d.fut);
  const T = { brut: 0, base: 0, urssaf: 0, net: 0, dep: 0, reste: 0 };
  for (const d of counted) for (const k in T) T[k] += d[k];
  for (const k in T) T[k] = r2(T[k]);
  const map = new Map();
  for (const d of counted) for (const it of d.items) if (it.type === 'depense') {
    const k = norm(it.label); const c = map.get(k) || { label: it.label, total: 0, rec: false };
    c.total += Number(it.amount) || 0; if (it.kind === 'rec') c.rec = true; map.set(k, c);
  }
  return { months, counted, T, top: Array.from(map.values()).sort((a, b) => b.total - a.total) };
}
let lastChartW = 0;
function renderAnnee() {
  const y = S.year, ok = ready(), yd = yearData(y), T = yd.T, pro = isPro();
  const n = yd.counted.length;
  $('#y-period').textContent = !ok ? 'Chargement…' : n === 0 ? 'Cette année n\'a pas encore commencé.' : n === 12 ? 'Année ' + y + ' complète' : 'De janvier à ' + MONTHS[n - 1] + ' ' + y + ' (les mois suivants sont affichés en pâle)';
  const k = (sw, label, v, cls) => '<div class="kpi' + (cls ? ' ' + cls : '') + '"><span><i class="sw ' + sw + '"></i>' + label + '</span><strong>' + (ok ? eur(v) : '…') + '</strong></div>';
  const kr = k(T.reste < 0 ? 's-manque' : 's-reste', T.reste < 0 ? 'Il manque' : 'Reste', T.reste, 'wide ' + (T.reste < 0 ? 'neg' : 'pos'));
  $('#kpis').innerHTML = pro
    ? k('s-brut', 'Revenus bruts', T.brut) + k('s-urssaf', 'URSSAF', T.urssaf) + k('s-net', 'Revenus nets', T.net) + k('s-dep', 'Dépenses', T.dep) + kr
    : k('s-net', 'Revenus', T.brut) + k('s-dep', 'Dépenses', T.dep) + kr;
  $('#kpis').style.gridTemplateColumns = pro ? '' : 'repeat(2,minmax(0,1fr))';
  lastChartW = 0; renderChart();
  let rows = '';
  for (const d of yd.months) {
    const cls = ['go', d.fut ? 'fut' : '', d.now ? 'now' : ''].join(' ');
    rows += '<tr class="' + cls + '" data-act="goto-month" data-month="' + d.m + '"><td><button class="cell-btn" data-act="goto-month" data-month="' + d.m + '">' + cap(MONTHS[pYM(d.m).m - 1]) + '</button></td>' +
      '<td>' + eur0(d.net) + '</td><td>' + eur0(d.dep) + '</td><td class="' + (d.fut ? '' : (d.reste < 0 ? 'neg' : 'pos')) + '">' + eur0(d.reste) + '</td></tr>';
  }
  $('#y-table').innerHTML = ok ? '<table><thead><tr><th>Mois</th><th>' + (pro ? 'Nets' : 'Revenus') + '</th><th>Dépenses</th><th>Reste</th></tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td>Total</td><td>' + eur0(T.net) + '</td><td>' + eur0(T.dep) + '</td><td class="' + (T.reste < 0 ? 'neg' : 'pos') + '">' + eur0(T.reste) + '</td></tr></tfoot></table>' : '<p class="empty">Chargement…</p>';
  const top = yd.top.slice(0, 8), max = top.length ? top[0].total : 1;
  $('#y-top').innerHTML = !ok ? '<p class="empty">Chargement…</p>' : top.length ? top.map(t =>
    '<div class="top-row"><span class="l">' + esc(t.label) + (t.rec ? '<small>fixe</small>' : '') + '</span><span class="a">' + eur(t.total) + '</span>' +
    '<span class="bar"><i style="width:' + Math.max(2, t.total / max * 100).toFixed(1) + '%"></i></span></div>').join('') : '<p class="empty">Aucune dépense sur cette période.</p>';
  if (pro) {
    const meter = (label, v, lim) => {
      const p = v / lim, cls = p >= 1 ? 'over' : p >= 0.8 ? 'warn' : '';
      return '<div class="meter ' + cls + '"><div class="meter-top"><b>' + label + '</b><span>' + eur(v) + ' / ' + eur(lim) + '</span></div><div class="bar"><i style="width:' + Math.min(100, Math.max(p * 100, v > 0 ? 1.5 : 0)).toFixed(1) + '%"></i></div></div>';
    };
    $('#y-meters').innerHTML = meter('Franchise de TVA', T.base, 37500) + meter('Plafond micro-entreprise', T.base, y >= 2026 ? 83600 : 77700);
  }
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function axLabel(v) { return v >= 1000 ? NUM.format(v / 1000) + ' k€' : NUM.format(v) + ' €'; }
function renderChart() {
  if (S.view !== 'annee' || !S.ready) return;
  const host = $('#chart');
  const W = Math.floor(host.clientWidth || 600);
  if (W === lastChartW && host.firstChild) return;
  lastChartW = W;
  if (!ready()) { host.innerHTML = ''; return; }
  const yd = yearData(S.year);
  const H = W < 520 ? 210 : 250, pl = 44, pr = 6, pt = 10, pb = 26;
  const iw = W - pl - pr, ih = H - pt - pb;
  const maxV = Math.max(100, ...yd.months.map(d => Math.max(d.net, d.dep)));
  const step = niceStep(maxV / 3), top = Math.ceil(maxV / step) * step;
  const Y = v => pt + ih - (v / top) * ih;
  const gw = iw / 12, bw = Math.max(4, Math.min(18, gw * 0.3));
  let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Revenus et dépenses par mois en ' + S.year + '">';
  for (let v = 0; v <= top + 0.001; v += step) {
    const yy = Math.round(Y(v)) + 0.5;
    s += '<line class="' + (v === 0 ? 'gl0' : 'gl') + '" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '"/>';
    s += '<text class="ax" x="' + (pl - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + axLabel(v) + '</text>';
  }
  yd.months.forEach((d, i) => {
    const x0 = pl + i * gw, cx = x0 + gw / 2;
    const hN = Math.max(0, Y(0) - Y(d.net)), hD = Math.max(0, Y(0) - Y(d.dep));
    s += '<g class="bar-g' + (d.fut ? ' fut' : '') + '" data-act="goto-month" data-month="' + d.m + '"><title>' + esc(cap(mLabel(d.m)) + ' : revenus ' + eur(d.net) + ', dépenses ' + eur(d.dep) + ', reste ' + eur(d.reste)) + '</title>' +
      '<rect class="b-hit" x="' + (x0 + 1) + '" y="' + pt + '" width="' + (gw - 2) + '" height="' + (ih + pb - 2) + '" rx="6"/>' +
      (hN > 0 ? '<rect class="b-net" x="' + (cx - bw - 1) + '" y="' + Y(d.net) + '" width="' + bw + '" height="' + hN + '" rx="2.5"/>' : '') +
      (hD > 0 ? '<rect class="b-dep" x="' + (cx + 1) + '" y="' + Y(d.dep) + '" width="' + bw + '" height="' + hD + '" rx="2.5"/>' : '') +
      '<text class="ax' + (d.now ? ' cur' : '') + '" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + (W < 520 ? MI[i] : MS[i].replace('.', '')) + '</text></g>';
  });
  host.innerHTML = s + '</svg>';
}
if (window.ResizeObserver) new ResizeObserver(() => renderChart()).observe($('#chart'));

function renderReglages() {
  $('#acc-email').textContent = (S.user && S.user.email) || '';
  $('#acc-version').textContent = APP_VERSION;
  $$('#profile-seg button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.pro === '1') === isPro())));
  const rates = $('#rates');
  if (isPro() && !rates.contains(document.activeElement)) {
    const ys = new Set(Object.keys(S.settings.taux).map(Number));
    ys.add(NOW.getFullYear()); ys.add(S.year);
    rates.innerHTML = Array.from(ys).sort((a, b) => b - a).map(y => '<label class="rate-row"><b>' + y + '</b><input class="input" data-year="' + y + '" inputmode="decimal" value="' + esc(NUM.format(rateFor(y))) + '" aria-label="Taux URSSAF ' + y + '"><span class="unit">%' + (S.settings.taux[y] == null ? ' <span class="hint">(repris)</span>' : '') + '</span></label>').join('');
  }
  $$('#period-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === S.settings.periodicite)));
  $('#export-btn').textContent = 'Exporter ' + S.year + ' en CSV';
  $('#admin-card').hidden = !S.isAdmin;
  renderAllow();
  renderColors();
  renderBackup();
  renderUpdate();
  calc();
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
    (e === me ? '<span class="hint">toi</span>' : '<button class="btn ghost danger" data-act="allow-del" data-email="' + esc(e) + '">Retirer</button>') + '</div>').join('') : '<p class="empty">Aucun email pour l\'instant.</p>';
}
$('#allow-form').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#allow-email').value.trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) { toast('Email invalide.', true); return; }
  write(setDoc(doc(db, 'allowlist', v), { addedAt: serverTimestamp() }), v + ' peut maintenant utiliser P-Flow');
  $('#allow-email').value = '';
});
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
      lines.push([it.kind === 'entry' ? it.date : d.m + '-01', d.m, rev ? 'Revenu' : 'Dépense', q(it.label), n(it.amount), u ? 'oui' : 'non', n(u ? it.amount * d.rate / 100 : 0), it.kind === 'rec' ? 'oui' : 'non'].join(';'));
    }
  }
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'p-flow-' + y + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- feuille d'ajout / modification ---------- */
const F = { mode: 'new', type: 'depense', orig: null, ctx: CUR, armed: false };
const bg = $('#sheet-bg'), form = $('#sheet');
let lastFocus = null;
function openSheet(o) {
  if (blocked()) return;
  lastFocus = document.activeElement;
  F.mode = o.mode; F.armed = false; F.ctx = S.view === 'mois' ? S.month : CUR;
  $('#f-error').textContent = '';
  if (o.mode === 'new') {
    F.orig = null; F.type = o.type || 'depense';
    $('#f-amount').value = ''; $('#f-label').value = '';
    $('#f-date').value = F.ctx === CUR ? TODAY : F.ctx + '-01';
    $('#f-rec').checked = !!o.rec; $('#f-urssaf').checked = true;
    $('#sheet-title').textContent = o.rec ? 'Nouveau fixe' : 'Nouvelle opération';
  } else {
    const it = (o.mode === 'edit-entry' ? S.entries : S.recurring).find(x => x.id === o.id); if (!it) return;
    F.orig = it; F.type = it.type === 'revenu' ? 'revenu' : 'depense';
    $('#f-amount').value = NUM.format(it.amount).replace(/[\s  ]/g, '');
    $('#f-label').value = it.label || '';
    $('#f-date').value = o.mode === 'edit-entry' ? it.date : (it.start + '-01');
    $('#f-rec').checked = o.mode === 'edit-rec'; $('#f-urssaf').checked = !!it.urssaf;
    $('#sheet-title').textContent = o.mode === 'edit-rec' ? 'Modifier le fixe' : 'Modifier';
  }
  bg.hidden = false; document.body.style.overflow = 'hidden';
  syncSheet();
  setTimeout(() => { const a = $('#f-amount'); a.focus(); if (o.mode !== 'new') a.select(); }, 60);
}
function closeSheet() {
  closeSuggest();
  bg.hidden = true; document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (e) { /* ignoré */ } }
}
function syncSheet() {
  const rev = F.type === 'revenu';
  $$('#type-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === F.type)));
  $('#f-label').placeholder = rev ? 'Salaire, facture client, CAF…' : 'Loyer, courses, plein d\'essence…';
  $('#f-urssaf-row').hidden = !rev || !isPro();
  const isRec = F.mode === 'edit-rec' || (F.mode === 'new' && $('#f-rec').checked);
  $('#f-rec-row').hidden = F.mode !== 'new';
  $('#f-date-label').textContent = isRec ? 'À partir du mois de' : 'Date';
  const del = $('#f-delete'); del.hidden = F.mode === 'new'; del.classList.remove('armed'); del.textContent = 'Supprimer';
  const stop = $('#f-stop');
  if (F.mode === 'edit-rec') { stop.hidden = false; stop.textContent = F.orig.end ? 'Reprendre chaque mois' : 'Arrêter après ' + MONTHS[pYM(F.ctx).m - 1]; }
  else stop.hidden = true;
  const hint = $('#f-hint');
  if (F.mode === 'edit-rec' && F.orig.start < F.ctx && (!F.orig.end || F.orig.end >= F.ctx)) {
    hint.hidden = false; hint.textContent = 'Un nouveau montant compte à partir de ' + mLabel(F.ctx) + '. Les mois d\'avant gardent ' + eur(F.orig.amount) + '.';
  } else hint.hidden = true;
  updatePreview();
  // Les suggestions dépendent du type (dépense ou revenu).
  if (document.activeElement === $('#f-label')) suggest(); else closeSuggest();
}
function updatePreview() {
  const p = $('#f-preview'), a = parseAmount($('#f-amount').value);
  const date = $('#f-date').value || TODAY, y = +date.slice(0, 4) || NOW.getFullYear();
  const isRec = F.mode === 'edit-rec' || (F.mode === 'new' && $('#f-rec').checked);
  if (F.type === 'revenu' && isPro() && $('#f-urssaf').checked) {
    const rate = rateFor(y);
    p.hidden = false;
    p.innerHTML = a > 0 ? 'URSSAF ' + pctf(rate) + ' : <b>' + MINUS + eur(a * rate / 100) + '</b> · il te reste <b>' + eur(a - r2(a * rate / 100)) + '</b>' : 'Tape le montant brut : le net et la part URSSAF s\'affichent ici.';
  } else if (isRec && F.mode === 'new') {
    p.hidden = false; p.textContent = 'Compté automatiquement chaque mois à partir de ' + mLabel(date.slice(0, 7)) + '.';
  } else p.hidden = true;
}
$('#type-seg').addEventListener('click', e => { const b = e.target.closest('button[data-type]'); if (!b) return; F.type = b.dataset.type; syncSheet(); });
['#f-amount', '#f-date'].forEach(id => $(id).addEventListener('input', updatePreview));
$('#f-urssaf').addEventListener('change', updatePreview);
$('#f-rec').addEventListener('change', syncSheet);
$('#sheet-close').addEventListener('click', closeSheet);
bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !bg.hidden) closeSheet(); });

form.addEventListener('submit', e => {
  e.preventDefault();
  if (blocked()) { closeSheet(); return; }
  const err = m => { $('#f-error').textContent = m; };
  const amount = parseAmount($('#f-amount').value);
  const label = $('#f-label').value.trim().replace(/\s+/g, ' ');
  const date = $('#f-date').value;
  if (!(amount > 0)) return err('Indique un montant supérieur à 0, par exemple 12,50.');
  if (!label) return err('Écris à quoi correspond ce montant.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('Choisis une date.');
  const month = date.slice(0, 7), type = F.type, urssaf = type === 'revenu' && isPro() && $('#f-urssaf').checked;
  const mode = F.mode, o = F.orig, cm = F.ctx;
  closeSheet();
  if (mode === 'new') {
    if ($('#f-rec').checked) write(addDoc(ucol('recurring'), { type, label, amount, urssaf, start: month, end: null, createdAt: Date.now() }), 'Fixe ajouté à partir de ' + mLabel(month));
    else write(addDoc(ucol('entries'), { type, label, amount, urssaf, date, month, createdAt: Date.now() }), (S.view === 'mois' && month !== S.month) ? 'Enregistré en ' + mLabel(month) : 'Enregistré');
  } else if (mode === 'edit-entry') {
    // Repartir du document lu : un champ ajouté par une version plus récente n'est jamais effacé.
    write(setDoc(doc(ucol('entries'), o.id), Object.assign(plain(o), { type, label, amount, urssaf, date, month, createdAt: o.createdAt || Date.now() })), 'Modifié');
  } else {
    const startChanged = month !== o.start;
    const valueChanged = amount !== o.amount || type !== o.type || urssaf !== !!o.urssaf;
    if (!startChanged && valueChanged && o.start < cm && (!o.end || o.end >= cm)) {
      write(Promise.all([
        setDoc(doc(ucol('recurring'), o.id), Object.assign(plain(o), { label, end: addM(cm, -1) })),
        addDoc(ucol('recurring'), Object.assign(plain(o), { type, label, amount, urssaf, start: cm, end: o.end || null, createdAt: Date.now() })),
      ]), 'Nouveau montant à partir de ' + mLabel(cm));
    } else {
      write(setDoc(doc(ucol('recurring'), o.id), Object.assign(plain(o), { type, label, amount, urssaf, start: month })), 'Modifié');
    }
  }
});
$('#f-delete').addEventListener('click', () => {
  if (blocked()) { closeSheet(); return; }
  const b = $('#f-delete');
  if (!F.armed) { F.armed = true; b.classList.add('armed'); b.textContent = F.mode === 'edit-rec' ? 'Confirmer : retirer de tous les mois' : 'Confirmer la suppression'; return; }
  const o = F.orig, mode = F.mode; closeSheet();
  if (mode === 'edit-entry') write(deleteDoc(doc(ucol('entries'), o.id)), 'Supprimé');
  else write(deleteDoc(doc(ucol('recurring'), o.id)), 'Fixe supprimé');
});
$('#f-stop').addEventListener('click', () => {
  if (blocked()) { closeSheet(); return; }
  const o = F.orig, cm = F.ctx; closeSheet();
  if (o.end) write(setDoc(doc(ucol('recurring'), o.id), Object.assign(plain(o), { end: null })), 'Repris chaque mois');
  else { const end = cm < o.start ? o.start : cm; write(setDoc(doc(ucol('recurring'), o.id), Object.assign(plain(o), { end })), 'Arrêté après ' + mLabel(end)); }
});

/* ---------- suggestions de libellés (dans la fenêtre, sous le champ) ---------- */
const fold = s => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const lab = $('#f-label'), sug = $('#f-suggest');
const SG = { items: [], active: -1 };
// Libellés déjà utilisés pour ce type, du plus fréquent au plus récent.
function labelPool(type) {
  const m = new Map();
  const add = it => {
    if (it.type !== type) return;
    const k = fold(it.label); if (!k) return;
    const c = m.get(k) || { l: it.label, n: 0, t: 0 };
    c.n++; c.t = Math.max(c.t, Number(it.createdAt) || 0); m.set(k, c);
  };
  S.entries.forEach(add); S.recurring.forEach(add);
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
const KB = { native: 0, base: window.innerHeight, cover: 0, open: false };
const isEditable = el => !!el && ((el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file)$/.test(el.type)) || el.tagName === 'TEXTAREA' || el.isContentEditable);
function kbUpdate() {
  const vv = window.visualViewport;
  let top = 0, cover = 0;
  if (vv && vv.scale < 1.01) { // pas pendant un zoom au doigt
    top = Math.max(0, vv.offsetTop);
    cover = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
  }
  // Hauteur annoncée par Android, moins ce que la fenêtre a déjà perdu (anciens Android qui la redimensionnent).
  const nat = Math.max(0, KB.native - Math.max(0, KB.base - window.innerHeight));
  cover = Math.round(Math.max(cover, nat));
  if (cover < 2) cover = 0;
  const root = document.documentElement;
  root.style.setProperty('--kb', cover + 'px');
  root.style.setProperty('--kb-top', Math.round(top) + 'px');
  const open = cover > 0 || (KB.base - window.innerHeight > 120 && isEditable(document.activeElement));
  root.classList.toggle('kb-open', open);
  const changed = cover !== KB.cover || open !== KB.open;
  KB.cover = cover; KB.open = open;
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
function setView(v) {
  S.view = v;
  try { history.replaceState(null, '', '#' + v); } catch (e) { /* ignoré */ }
  ensureYearSub(); render(); window.scrollTo(0, 0);
}
function setMonth(m) { S.month = m; S.year = pYM(m).y; ensureYearSub(); render(); }
function setYear(y) { S.year = y; ensureYearSub(); render(); }
const armedAllow = new Set();
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act;
  if (a === 'logout') { logout(); return; }
  if (!S.ready) return;
  if (a === 'view') setView(t.dataset.view);
  else if (a === 'prev-month') setMonth(addM(S.month, -1));
  else if (a === 'next-month') setMonth(addM(S.month, 1));
  else if (a === 'today') setMonth(CUR);
  else if (a === 'prev-year') setYear(S.year - 1);
  else if (a === 'next-year') setYear(S.year + 1);
  else if (a === 'add') openSheet({ mode: 'new', rec: S.view === 'fixes' });
  else if (a === 'add-rec') openSheet({ mode: 'new', rec: true });
  else if (a === 'edit-entry') openSheet({ mode: 'edit-entry', id: t.dataset.id });
  else if (a === 'edit-rec') openSheet({ mode: 'edit-rec', id: t.dataset.id });
  else if (a === 'toggle-fixed') { S.showFixed = !S.showFixed; lsSet('pf-showFixed', S.showFixed ? '1' : '0'); renderMois(); }
  else if (a === 'toggle-ended') { S.showEnded = !S.showEnded; renderFixes(); }
  else if (a === 'goto-month') { S.month = t.dataset.month; S.year = pYM(S.month).y; setView('mois'); }
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
  }
});

let toastT = null;
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2200);
}

/* ---------- appli Android : retour et mises à jour ---------- */
if (isNative) {
  CapApp.addListener('backButton', () => {
    if (!bg.hidden) { closeSheet(); return; }
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
const verLabel = v => String(v || '').replace(/-beta/, ' bêta').replace(/-test(\d+)$/, ' (test $1)');
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
  // Réglages → Mises à jour
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
const BK = { busy: false, status: '', err: false, due: false, triedAuto: false, list: null, plan: null, link: null };
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
  const [st, es, rs] = await fromServer(Promise.all([getDocFromServer(uref('meta', 'settings')), getDocsFromServer(ucol('entries')), getDocsFromServer(ucol('recurring'))]));
  return {
    app: 'P-Flow', format: 1, dataVersion: DATA_VERSION, appVersion: RAW_VERSION, exportedAt: new Date().toISOString(),
    settings: st.exists() ? cleanDoc(st.data()) : null,
    entries: es.docs.map(d => Object.assign({ id: d.id }, cleanDoc(d.data()))),
    recurring: rs.docs.map(d => Object.assign({ id: d.id }, cleanDoc(d.data()))),
  };
}
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/, YM_RE = /^\d{4}-\d{2}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validItem(it, kind) {
  if (!it || typeof it !== 'object' || !ID_RE.test(String(it.id))) return false;
  if (it.type !== 'revenu' && it.type !== 'depense') return false;
  if (!(typeof it.amount === 'number' && isFinite(it.amount) && it.amount > 0)) return false;
  if (typeof it.label !== 'string' || !it.label.trim()) return false;
  if (kind === 'entries') return DATE_RE.test(it.date) && YM_RE.test(it.month);
  return YM_RE.test(it.start) && (it.end == null || YM_RE.test(it.end));
}
function parseBackup(text) {
  let o = null;
  try { o = JSON.parse(text); } catch (e) { /* pas du JSON */ }
  if (!o || o.app !== 'P-Flow' || !Array.isArray(o.entries) || !Array.isArray(o.recurring)) throw new Error('Ce fichier n\'est pas une sauvegarde P-Flow.');
  if ((Number(o.dataVersion) || 1) > DATA_VERSION) throw new Error('Cette sauvegarde vient d\'une version plus récente de P-Flow : mets l\'appli à jour pour la restaurer.');
  const entries = o.entries.filter(x => validItem(x, 'entries')), recurring = o.recurring.filter(x => validItem(x, 'recurring'));
  return { when: o.exportedAt, entries, recurring, invalid: o.entries.length - entries.length + o.recurring.length - recurring.length };
}
async function planRestore(bk, source) {
  const [es, rs] = await fromServer(Promise.all([getDocsFromServer(ucol('entries')), getDocsFromServer(ucol('recurring'))]));
  const haveE = new Set(es.docs.map(d => d.id)), haveR = new Set(rs.docs.map(d => d.id));
  return { source, when: bk.when, total: [bk.entries.length, bk.recurring.length], invalid: bk.invalid,
    addE: bk.entries.filter(x => !haveE.has(x.id)), addR: bk.recurring.filter(x => !haveR.has(x.id)) };
}
function applyRestore(plan) {
  if (blocked()) return;
  const strip = o => { const c = {}; for (const k of Object.keys(o)) if (k !== 'id' && !k.startsWith('__')) c[k] = o[k]; return c; };
  const jobs = plan.addE.map(x => setDoc(doc(ucol('entries'), x.id), strip(x))).concat(plan.addR.map(x => setDoc(doc(ucol('recurring'), x.id), strip(x))));
  const n = plan.addE.length, m = plan.addR.length;
  write(Promise.all(jobs), n + ' opération' + (n > 1 ? 's' : '') + ' et ' + m + ' fixe' + (m > 1 ? 's' : '') + ' remis');
  BK.plan = null; renderBackup();
}
const plural = (n, w) => n + ' ' + w + (n > 1 ? 's' : '');
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
    if (auto) { BK.due = true; BK.status = ''; } else setBk(driveErr(e), true);
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
    const n = plan.addE.length, m = plan.addR.length;
    p.innerHTML = '<p><b>Sauvegarde du ' + esc(fmtWhen(plan.when)) + '</b> (' + esc(plan.source) + ')</p>' +
      '<p class="hint">Elle contient ' + plural(plan.total[0], 'opération') + ' et ' + plural(plan.total[1], 'fixe') + '.' + (plan.invalid ? ' ' + plural(plan.invalid, 'ligne illisible') + ' ignorée' + (plan.invalid > 1 ? 's' : '') + '.' : '') + '</p>' +
      (n + m ? '<p>À remettre dans ton compte : <b>' + plural(n, 'opération') + ' et ' + plural(m, 'fixe') + '</b> qui manquent. Ce qui est déjà dans ton compte ne change pas, et rien n\'est supprimé.</p>' +
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

setLoginMode('login');
