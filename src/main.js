// Patch 4 : une seule police, Figtree (variable, chiffres tabulaires), à la place de trois.
import '@fontsource-variable/figtree/wght.css';
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
import { initPickers, openCalendar, openChoice, openHue, popOpen, closePop, openPopover, setPopAnchor, popBox } from './pickers.js';

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
const SUBS = { compte: 'Mon compte et mon profil', pro: 'Auto-entrepreneur', apparence: 'Apparence', donnees: 'Mes données', partage: 'Partager P-Flow', admin: 'Administration', apropos: 'À propos' };
// Couleurs personnalisables : clé (variable CSS --c-<clé>), libellé, réservée au profil auto-entrepreneur.
// Patch 3 : + Autres revenus (sans URSSAF), Fixes (pastilles du calendrier) et Épargne (affichée si l'épargne est suivie) ;
// nouvelles clés facultatives de `couleurs`, ignorées par les versions d'avant (elles ne lisent que leurs clés).
const COLORS = [['brut', 'Revenus bruts', true], ['urssaf', 'URSSAF', true], ['autres', 'Autres revenus', true], ['net', 'Revenus nets', false],
  ['dep', 'Dépenses', false], ['fixes', 'Fixes', false], ['ep', 'Épargne', false], ['reste', 'Reste', false]];
const PRESETS = [['#2453c4', 'Bleu'], ['#7da3ff', 'Bleu clair'], ['#0e9aa7', 'Turquoise'], ['#16845a', 'Vert'], ['#4dc48b', 'Vert clair'], ['#c2810c', 'Ambre'],
  ['#e4a940', 'Jaune'], ['#e0662e', 'Orange'], ['#c23b35', 'Rouge'], ['#d9488f', 'Rose'], ['#7a5af8', 'Violet'], ['#6a7d90', 'Gris']];
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
// Couleurs d'accentuation (réglage facultatif `accent` du compte, patch 2) : identifiant, nom, couleur claire, couleur sombre.
// Les teintes sont dans style.css (:root[data-accent=…]) ; « bleu » = couleurs par défaut.
const ACCENTS = [['bleu', 'Bleu', '#2A5BD7', '#7DA3FF'], ['violet', 'Violet', '#6B4BE0', '#A992FF'], ['rose', 'Rose', '#C5367C', '#F48CC0'],
  ['rouge', 'Rouge', '#C8372F', '#FF7A70'], ['orange', 'Orange', '#C9561A', '#FF9A5C'], ['ambre', 'Ambre', '#A86A00', '#F2B84B'],
  ['vert', 'Vert', '#13865A', '#4DC48B'], ['turquoise', 'Turquoise', '#0A8794', '#45C8D6'], ['graphite', 'Graphite', '#3A4656', '#B9C4D2']];
const isAccent = v => ACCENTS.some(([k]) => k === v);
// Pastilles de Réglages → Apparence : reconstruites seulement quand le thème change (teintes claires / sombres),
// sinon simple mise à jour de la pastille cochée (garde le focus et l'animation de la coche).
function renderAccents() {
  const ac = $('#accents'); if (!ac || !S.settings) return;
  const dk = isDark() ? 'd' : 'l';
  if (ac.dataset.dk !== dk || !ac.firstChild) { ac.dataset.dk = dk; ac.innerHTML = accentDots(S.settings.accent, 'data-act="accent"'); return; }
  $$('[data-a]', ac).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.a === S.settings.accent)));
}
const accentDots = (cur, attr) => ACCENTS.map(([k, n, l, d]) => '<button type="button" class="dot" ' + attr + ' data-a="' + k + '" style="background:' + (isDark() ? d : l) + '" aria-label="' + n + '" aria-pressed="' + (cur === k) + '">' + ico('check') + '</button>').join('');
// Fréquences des copies automatiques sur Google Drive (en jours).
const BK_FREQ = { hebdomadaire: 7, mensuelle: 30, annuelle: 365 };
// Fixes : fréquence → nombre de mois entre deux échéances (collection `periodiques`, patch 2).
const FREQ = { mois: 1, trimestre: 3, annee: 12 };
const FREQ_LABEL = { mois: 'chaque mois', trimestre: 'chaque trimestre', annee: 'chaque année' };
const FREQ_UNIT = { mois: '/mois', trimestre: '/trim.', annee: '/an' };
// Mots des choix de fréquence (patch 3) : courts et de la même forme.
const FREQ_WORD = { mois: 'Mensuel', trimestre: 'Trimestriel', annee: 'Annuel' };
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
// « d'août 2026 », « de sept. 2026 » (patch 4).
const deMS = s => { const { y, m } = pYM(s); return (/^[aeiouyàâéèêîôû]/i.test(MS[m - 1]) ? 'd\'' : 'de ') + MS[m - 1] + ' ' + y; };
const dLabel = d => { const p = d.split('-'); return (+p[2]) + ' ' + MS[+p[1] - 1]; };
// « de mars », mais « d'avril », « d'août », « d'octobre ».
const deMois = i => (/^[aeiouyàâéèêîôû]/i.test(MONTHS[i]) ? 'd\'' : 'de ') + MONTHS[i];
// « d'octobre 2026 », « à partir d'avril 2026 » (élision devant avril, août, octobre).
const deM = s => deMois(pYM(s).m - 1) + ' ' + pYM(s).y;
// « en janvier 2026 » pour un seul mois, « de janvier à mars 2026 » sinon (avertissements des fixes).
const plusRange = (a, b) => (a === b ? 'en ' + mLabel(a) : deM(a) + ' à ' + mLabel(b));
const aPartir = s => 'à partir ' + deM(s);
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
// pf-accent (copie locale de la couleur d'accentuation du compte) : écrite par applyColors(), lue par ce script.
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
initPickers({ motionOK, today: () => new Date() });
let lastBars = '';
function applyAppearance() {
  const d = document.documentElement, dark = isDark();
  d.setAttribute('data-scheme', dark ? 'dark' : 'light');
  if (APP.noir) d.setAttribute('data-noir', ''); else d.removeAttribute('data-noir');
  if (APP.texte === 'grand') d.setAttribute('data-texte', 'grand'); else d.removeAttribute('data-texte');
  if (APP.effets === 'reduits') d.setAttribute('data-effets', 'reduits'); else d.removeAttribute('data-effets');
  const cs = getComputedStyle(d);
  const top = cs.getPropertyValue('--bg-top').trim() || (dark ? '#111A2B' : '#E2E9F8');
  const bottom = cs.getPropertyValue('--bg').trim() || (dark ? '#0A0E14' : '#EEF2F8');
  const meta = $('#meta-theme'); if (meta) meta.setAttribute('content', top);
  // Android : barres du système (heure, batterie) assorties au thème choisi dans l'appli ; en bas, la couleur du
  // bas de la page (fond derrière la barre de navigation).
  const bars = top + bottom + (dark ? 'd' : 'l');
  if (isNative && bars !== lastBars) {
    lastBars = bars;
    try {
      PFlowNative.setSystemBars({ color: top, bottom, light: !dark }).then(res => {
        // Android 15+ : la page passe sous la barre d'état ; sa hauteur sert d'espace en haut (variable --sat).
        if (res && typeof res.top === 'number' && res.top >= 0) d.style.setProperty('--sat', Math.min(res.top, 120) + 'px');
      }).catch(() => {});
    } catch (e) { /* ancienne appli native */ }
  }
  lastChartW = 0;
  if (S.ready) { renderChart(); requestAnimationFrame(() => positionIndicator(false)); }
  renderAccents();
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
const riseIn = el => anim(el, [{ transform: 'translateY(10px) scale(.98)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: SPRING });
/* Patch 4 : passe d'animations (toujours transform / opacity, coupées par « Effets réduits »). */
// Éléments qui arrivent en cascade : seulement ceux visibles à l'écran (positions lues juste après le rendu ;
// animate() ne change pas la mise en page, donc une seule mise en page pour toute la boucle).
function cascadeIn(els, o) {
  if (!motionOK()) return;
  const H = window.innerHeight, max = (o && o.max) || 10, dy = (o && o.dy) || 14, step = (o && o.step) || 34;
  let i = 0;
  for (const el of els) {
    if (i >= max) break;
    const r = el.getBoundingClientRect();
    if (!r.height || r.bottom < 0 || r.top > H) continue;
    anim(el, [{ opacity: 0, transform: 'translateY(' + dy + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: i * step, easing: SPRING, fill: 'backwards' });
    i++;
  }
}
// Montant qui défile d'une valeur à l'autre (écran Année, Fixes) ; le premier affichage ne bouge pas.
const ROLL = new Map();
function rollNumber(el, key, v, fmt) {
  const from = ROLL.get(key); ROLL.set(key, v);
  if (!el || from == null || from === v || !motionOK()) return;
  const f = fmt || eur, t0 = performance.now(), D = 520;
  const step = t => {
    if (!el.isConnected) return;
    const p = Math.min(1, (t - t0) / D), k = 1 - Math.pow(1 - p, 3);
    el.textContent = f(p < 1 ? from + (v - from) * k : v);
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = f(from);
  requestAnimationFrame(step);
}
// Barres qui poussent depuis la ligne du zéro (graphique de l'année, barres du calcul du mois).
function growBars(els, axis) {
  if (!motionOK()) return;
  const s = axis === 'x' ? 'scaleX(0)' : 'scaleY(0)';
  Array.from(els).slice(0, 24).forEach((el, i) => anim(el, [{ transform: s }, { transform: 'none' }], { duration: 560, delay: i * 22, easing: SPRING, fill: 'backwards' }));
}
// Boutons à choix (segments) : le choix fait un petit rebond « liquide ».
document.addEventListener('click', e => {
  const b = e.target.closest('.seg button');
  if (!b || b.disabled) return;
  requestAnimationFrame(() => {
    const on = b.closest('.seg') && b.closest('.seg').querySelector('button[aria-pressed="true"]');
    if (on) anim(on, [{ transform: 'scale(.9)' }, { transform: 'scale(1.04)', offset: 0.55 }, { transform: 'none' }], { duration: 380, easing: EASE });
  });
});

/* ---------- écrans ---------- */
const SCREENS = ['s-boot', 's-login', 's-verify', 's-denied', 's-onboard', 'app'];
function show(id) {
  SCREENS.forEach(s => {
    // Patch 4 : l'écran de chargement ne disparaît pas d'un coup : les vagues dévoilent l'écran suivant.
    if (s === 's-boot' && id !== 's-boot') { bootReveal(); return; }
    $('#' + s).hidden = s !== id;
  });
}
// Animation d'ouverture (patch 4) : courte si tout est prêt (au moins la chute de la goutte et la première vague,
// ~0,75 s après le lancement), sinon les vagues tournent en boucle tant que ça charge. Elle ne bloque jamais les
// touchers (pointer-events: none). « Effets réduits » ou « réduire les animations » : simple fondu.
let bootState = 'on';
function bootReveal() {
  const b = $('#s-boot');
  if (bootState !== 'on' || !b || b.hidden) return;
  bootState = 'leaving';
  const go = () => {
    if (motionOK()) {
      b.classList.add('out');
      setTimeout(() => { b.hidden = true; bootState = 'off'; }, 760);
    } else {
      const a = b.animate ? b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }) : null;
      const end = () => { b.hidden = true; bootState = 'off'; };
      if (a) a.finished.then(end, end); else end();
    }
  };
  const wait = 750 - performance.now();
  if (wait > 0 && motionOK()) setTimeout(go, wait); else go();
}

/* ---------- état ---------- */
const S = {
  user: null, isAdmin: false, ready: false,
  view: 'mois', month: CUR, year: NOW.getFullYear(), sub: null,
  entries: [], entriesYear: null, unsubEntries: null,
  recurring: [], periodiques: [], epargne: [], demandes: [],
  // Patch 3 : jours des fixes (`jours/{id du fixe}`), soldes du compte courant (`soldes`), réponses « déjà passée ? » (`pointages`).
  jours: [], soldes: [], pointages: [],
  // Patch 4 : paiements de l'URSSAF (`urssaf/{période}`), rangés à part.
  urssafPay: [],
  settings: null, settingsExists: false, readOnly: false,
  loaded: { entries: false, recurring: false, settings: false, periodiques: false, epargne: false, jours: false, soldes: false, pointages: false, urssafPay: false },
  pend: { entries: false, recurring: false, settings: false, periodiques: false, epargne: false, jours: false, soldes: false, pointages: false, urssafPay: false },
  showFixed: lsGet('pf-showFixed') === '1', grouped: lsGet('pf-groupe') === '1', openGroups: new Set(),
  showEnded: false, colorOpen: null, ucOpen: false, simOpen: false, bubble: null, casInfo: null,
  showFixedRev: lsGet('pf-showFixedRev') === '1',
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
  // Champ facultatif `accent` (patch 2) : couleur d'accentuation, la même sur tous les appareils.
  const accent = isAccent(d.accent) ? d.accent : 'bleu';
  // Champs facultatifs `objectif` et `objectifs` (patch 4) : ce qu'on veut garder sur son compte à la fin du mois.
  // `objectif` vaut pour tous les mois ; `objectifs` = { 'AAAA-MM': montant } pour un mois réglé à part. null = rien.
  const okAmt = v => typeof v === 'number' && isFinite(v) && v >= 0;
  const objectifs = {};
  if (d.objectifs && typeof d.objectifs === 'object') for (const k of Object.keys(d.objectifs)) if (YM_RE.test(k) && okAmt(d.objectifs[k])) objectifs[k] = r2(d.objectifs[k]);
  const objectif = okAmt(d.objectif) ? r2(d.objectif) : null;
  return { pro: !!d.pro, taux, periodicite: d.periodicite === 'trimestrielle' ? 'trimestrielle' : 'mensuelle', couleurs, sauvegarde, epargne, accent, objectif, objectifs };
}
// Objectif de fin de mois du mois m (patch 4) : réglé pour ce mois, sinon celui de tous les mois, sinon null.
function objectifOf(m) {
  if (!S.settings) return null;
  const o = S.settings.objectifs[m];
  return o != null ? o : S.settings.objectif;
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
  const c = (S.settings && S.settings.couleurs) || {}, root = document.documentElement, st = root.style;
  for (const [k] of COLORS) { if (c[k]) st.setProperty('--c-' + k, c[k]); else st.removeProperty('--c-' + k); }
  if (S.settings) {
    setAccent(S.settings.accent);
    lsSet('pf-accent', S.settings.accent); // copie locale : appliquée dès l'ouverture suivante, avant la synchronisation
  }
}
function setAccent(a) {
  const root = document.documentElement;
  if (isAccent(a) && a !== 'bleu') root.setAttribute('data-accent', a); else root.removeAttribute('data-accent');
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
// Jour du mois d'un fixe (patch 3, collection `jours`, rangé à part : jamais dans `recurring`). null = pas choisi (le 1er).
function jourOf(id) { const j = S.jours.find(x => x.id === id); const n = j && Number(j.jour); return n >= 1 && n <= 31 ? Math.floor(n) : null; }
// Date réelle d'un fixe dans le mois m (29-31 → dernier jour des mois plus courts).
function fixeDate(it, m) { const { y, m: mm } = pYM(m); const j = Math.min(jourOf(it.id) || 1, new Date(y, mm, 0).getDate()); return m + '-' + pad(j); }
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
// Opérations chargées : l'année affichée, plus octobre à décembre de l'année d'avant (patch 3) pour l'URSSAF
// du trimestre ou du mois précédent payée en janvier, la comparaison de janvier et le solde du compte.
const entCovered = m => S.entriesYear !== null && m >= ym(S.entriesYear - 1, 10) && m <= ym(S.entriesYear, 12);
function monthItems(m) {
  const ents = (entCovered(m) ? S.entries : []).filter(e => e.month === m).map(e => Object.assign({ kind: 'entry' }, e));
  const recs = S.recurring.filter(r => r.start && r.start <= m && (!r.end || r.end >= m)).map(r => Object.assign({ kind: 'rec' }, r));
  const pers = S.periodiques.filter(p => (p.type === 'depense' || p.type === 'revenu') && perDue(p, m)).map(p => Object.assign({ kind: 'per' }, p));
  return { ents, recs, pers, items: ents.concat(recs, pers) };
}
// Chiffre d'affaires soumis à l'URSSAF du mois m.
function baseOf(m) {
  if (!isPro()) return 0;
  return r2(monthItems(m).items.reduce((a, it) => a + (it.type === 'revenu' && it.urssaf ? Number(it.amount) || 0 : 0), 0));
}
/* ----- paiements de l'URSSAF (patch 4) ----- */
// `urssaf/{période}` = { payee, date, montant, createdAt } ; période = 'AAAA-MM' (déclaration mensuelle) ou 'AAAA-T1'…'AAAA-T4'
// (trimestrielle). payee true : payée ce jour-là, ce montant réel (il remplace l'estimation partout) ; false : pas encore.
const quarterOf = m => Math.floor((pYM(m).m - 1) / 3);
const quarterMonths = m => [1, 2, 3].map(k => ym(pYM(m).y, quarterOf(m) * 3 + k));
const isQuarterly = () => !!(S.settings && S.settings.periodicite === 'trimestrielle');
const perId = m => (isQuarterly() ? pYM(m).y + '-T' + (quarterOf(m) + 1) : m);
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function paiementOf(id) {
  const p = S.urssafPay.find(x => x.id === id);
  if (!p) return null;
  if (p.payee === true && DATE_RE.test(p.date || '') && typeof p.montant === 'number' && isFinite(p.montant) && p.montant >= 0) return { id, payee: true, date: p.date, montant: r2(p.montant) };
  if (p.payee === false) return { id, payee: false };
  return null;
}
// Part du montant réellement payé qui revient au mois m (null = pas de paiement noté : on garde l'estimation).
// Trimestriel : réparti sur les 3 mois selon le chiffre d'affaires de chacun (le dernier mois prend l'arrondi).
function urssafReel(m, base) {
  if (!isPro() || !S.settings) return null;
  const p = paiementOf(perId(m));
  if (!p || !p.payee) return null;
  if (!isQuarterly()) return p.montant;
  const ms = quarterMonths(m), bases = ms.map(x => (x === m ? base : baseOf(x))), tot = r2(bases.reduce((a, b) => a + b, 0));
  const shares = tot > 0 ? bases.map(b => r2(p.montant * b / tot)) : [0, 0, p.montant];
  const last = tot > 0 ? bases.map(b => b > 0).lastIndexOf(true) : 2;
  shares[last] = r2(p.montant - shares.reduce((a, s, i) => a + (i === last ? 0 : s), 0));
  return shares[ms.indexOf(m)];
}
function monthData(m) {
  const y = pYM(m).y;
  const { ents, recs, pers, items } = monthItems(m);
  const rate = rateFor(y);
  let brut = 0, base = 0, dep = 0;
  for (const it of items) {
    const a = Number(it.amount) || 0;
    if (it.type === 'revenu') { brut += a; if (it.urssaf && isPro()) base += a; } else dep += a;
  }
  brut = r2(brut); base = r2(base); dep = r2(dep);
  // Patch 4 : une fois payée, le montant réel remplace l'estimation partout (cascade, reste, écran Année, solde).
  const urssafEst = r2(base * rate / 100), reel = urssafReel(m, base);
  const urssaf = reel != null ? reel : urssafEst;
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
  return { m, items, ents, recs, pers, eps, autos, rate, brut, base, urssaf, urssafEst, urssafReel: reel != null, net, dep, epIn, epOut, ep, reste: r2(net - dep - ep) };
}
// Comptes d'épargne : solde = dernier « J'ai actuellement » + dépôts − retraits notés depuis (versements automatiques compris).
// upTo (AAAA-MM) : solde à la fin de ce mois (par défaut le mois en cours).
function comptes(upTo) {
  const lim = upTo || CUR;
  const map = new Map();
  const get = l => { const k = norm(l); let c = map.get(k); if (!c) { c = { key: k, label: String(l).trim(), ev: [], autos: [] }; map.set(k, c); } return c; };
  for (const e of S.epargne) if (e.label && DATE_RE.test(e.date || '') && OPS.includes(e.op) && e.date.slice(0, 7) <= lim) get(e.label).ev.push({ d: e.date, t: Number(e.createdAt) || 0, op: e.op, a: Number(e.amount) || 0 });
  for (const p of S.periodiques) {
    if (p.type !== 'epargne' || !p.label || !perStep(p) || !YM_RE.test(p.start || '')) continue;
    const c = get(p.label); c.autos.push(p);
    for (let m = p.start, i = 0; m <= lim && i < 1200; m = addM(m, perStep(p)), i++) {
      if (p.end && m > p.end) break;
      c.ev.push({ d: m + '-01', t: -1, op: 'depot', a: Number(p.amount) || 0 });
    }
  }
  const out = [];
  for (const c of map.values()) {
    c.ev.sort((a, b) => a.d.localeCompare(b.d) || a.t - b.t);
    let bal = 0;
    for (const e of c.ev) { if (e.op === 'solde') bal = e.a; else if (e.op === 'retrait') bal -= e.a; else bal += e.a; }
    if (!c.ev.length && upTo) continue; // compte pas encore ouvert à cette date
    out.push({ key: c.key, label: c.label, solde: r2(bal), autos: c.autos.filter(p => !p.end || p.end >= lim) });
  }
  return out.sort((a, b) => b.solde - a.solde || a.label.localeCompare(b.label));
}
// Période URSSAF qui contient le mois m. total = montant réel s'il est noté, sinon l'estimation (est) ;
// pay = paiement noté (ou null) ; id = identifiant du document `urssaf/{id}`.
function urssafPeriod(m) {
  const { y, m: mm } = pYM(m), id = perId(m), pay = isPro() ? paiementOf(id) : null;
  if (isQuarterly()) {
    const q = quarterOf(m);
    let total = 0, base = 0, est = 0;
    for (const x of quarterMonths(m)) { const d = monthData(x); total += d.urssaf; base += d.base; est += d.urssafEst; }
    const dl = [new Date(y, 3, 30), new Date(y, 6, 31), new Date(y, 9, 31), new Date(y + 1, 0, 31)][q];
    return { id, pay, title: 'URSSAF du ' + ['1er', '2e', '3e', '4e'][q] + ' trimestre', short: 'du ' + ['1er', '2e', '3e', '4e'][q] + ' trimestre', sub: MS[q * 3] + ' → ' + MS[q * 3 + 2], total: r2(total), est: r2(est), base: r2(base), dl };
  }
  const d = monthData(m);
  return { id, pay, title: 'URSSAF ' + deMois(mm - 1), short: deMois(mm - 1), sub: '', total: d.urssaf, est: d.urssafEst, base: d.base, dl: new Date(y, mm + 1, 0), rate: d.rate };
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
  $('#d-email').textContent = user.email || ''; // patch 4 : plus d'instructions de la console Firebase sur cet écran
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
  toastUndoFn = null; // « Annuler » ne doit jamais écrire dans un autre compte
  S.unsubEntries = null; S.entriesYear = null; S.entries = []; S.recurring = []; S.periodiques = []; S.epargne = []; S.demandes = []; S.jours = []; S.soldes = []; S.pointages = []; S.urssafPay = [];
  S.settings = null; S.allow = []; S.sub = null; S.justOnboarded = false; S.bubble = null;
  S.readOnly = false; S.settingsServer = false; $('#outdated').hidden = true; applyColors();
  // Le message « Supprimé · Annuler » d'un compte ne reste pas affiché après la déconnexion (patch 4).
  clearTimeout(toastT); $('#toast').hidden = true;
  resetBackupState();
  S.loaded = { entries: false, recurring: false, settings: false, periodiques: false, epargne: false, jours: false, soldes: false, pointages: false, urssafPay: false };
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
  // Patch 3 : nouvelles collections (couvertes par la règle users/{uid}/…), ignorées par les anciennes versions.
  sub('jours', 'jours');
  sub('soldes', 'soldes');
  sub('pointages', 'pointages');
  // Patch 4 : paiements de l'URSSAF (couverte par la règle users/{uid}/…), ignorée par les anciennes versions.
  sub('urssaf', 'urssafPay');
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
    countEpOffer();
    if ($('#s-onboard').hidden || !OB.redo) show('app');
    maybeAutoUpdate();
    requestAnimationFrame(() => positionIndicator(false));
    // Patch 4 : pendant que les vagues dévoilent l'écran, ses blocs arrivent en cascade.
    setTimeout(() => { if (!$('#app').hidden) viewIn(S.view); }, Math.max(0, 760 - performance.now()));
    liveBgSchedule(6000); // fond vivant : première dérive quelques secondes après l'ouverture
    setTimeout(maybeNews, 700);
  }
  render();
}
// Offre d'épargne (patch 4) : clé locale `pf-offre-ep` = 'AAAA-MM-JJ|n' (première fois vue, nombre d'ouvertures de l'appli).
const EP_OFFER_MAX = 8;
function epOffer() {
  const [d, n] = String(lsGet('pf-offre-ep') || '').split('|');
  const first = DATE_RE.test(d || '') ? d : TODAY, count = Number(n) || 0;
  return { show: count <= EP_OFFER_MAX, fresh: first >= addD(TODAY, -30) };
}
function countEpOffer() {
  if (!S.settings || S.settings.epargne !== null || epOn() || S.readOnly) return;
  const [d, n] = String(lsGet('pf-offre-ep') || '').split('|');
  lsSet('pf-offre-ep', (DATE_RE.test(d || '') ? d : TODAY) + '|' + ((Number(n) || 0) + 1));
}
function neededYear() { return S.view === 'mois' ? pYM(S.month).y : S.year; }
function ensureYearSub() {
  if (!S.user) return;
  const y = neededYear();
  if (S.entriesYear === y && S.unsubEntries) return;
  if (S.unsubEntries) { try { S.unsubEntries(); } catch (e) { /* ignoré */ } }
  S.entriesYear = y; S.entries = []; S.loaded.entries = false;
  const q = query(ucol('entries'), where('month', '>=', ym(y - 1, 10)), where('month', '<=', y + '-12'));
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
// 7 étapes (patch 3 : « Ton compte en banque »), toutes facultatives (« Passer »). Écrit exactement les mêmes documents qu'un ajout manuel.
// Nouveau compte (meta/settings absent) : tout est écrit à la fin. « Refaire la configuration » (Réglages) :
// rien n'est supprimé, on ajoute seulement ce qui est saisi, et les réglages sont fusionnés.
const OB_STEPS = ['profil', 'revenus', 'charges', 'compte', 'epargne', 'apparence', 'sauvegarde'];
const OB_QUICK = {
  rev: ['Salaire', 'Aides (CAF…)', 'Pension', 'Loyer perçu'],
  dep: ['Loyer', 'Électricité', 'Internet', 'Téléphone', 'Assurance', 'Crédit', 'Abonnements'],
  ep: ['Livret A', 'LDDS', 'PEL', 'Assurance vie'],
};
const OB = { step: 0, redo: false, pro: false, rate: '', period: 'mensuelle', rev: [], dep: [], ep: null, comptes: [], solde: '', soldeNeg: false, drive: false, driveMsg: '', busy: false, accent: 'bleu' };
function openOnboarding(redo) {
  if (!redo && !$('#s-onboard').hidden && !OB.redo) return; // déjà ouvert : ne pas recommencer
  Object.assign(OB, { step: 0, redo, rev: [], dep: [], comptes: [], solde: '', soldeNeg: false, drive: false, driveMsg: '', busy: false,
    pro: redo ? isPro() : false, rate: redo && isPro() ? amountStr(rateFor(NOW.getFullYear())) : '',
    period: redo ? S.settings.periodicite : 'mensuelle', ep: redo ? (S.settings.epargne === null ? null : epOn()) : null,
    accent: redo ? S.settings.accent : 'bleu' });
  $('#o-error').textContent = '';
  show('s-onboard');
  obRender(0);
  window.scrollTo(0, 0);
}
function obRowHtml(kind, r, i) {
  const ep = kind === 'ep';
  // Patch 3 : plus de listes natives, une pilule de choix et le calendrier maison.
  const pick = (f, txt, lbl) => '<button type="button" class="input pick" data-ob="' + f + '" aria-haspopup="dialog" aria-expanded="false" aria-label="' + lbl + ' : ' + esc(txt) + '"><span>' + esc(txt) + '</span>' + ico(f === 'start' ? 'mois' : 'down') + '</button>';
  const freq = () => pick('freq', FREQ_WORD[r.freq] || FREQ_WORD.mois, 'Fréquence');
  const sm = YM_RE.test(r.start || '') ? r.start : CUR, { y: sy, m: smm } = pYM(sm);
  const startTxt = r.jour ? (Math.min(r.jour, new Date(sy, smm, 0).getDate()) === 1 ? '1er' : Math.min(r.jour, new Date(sy, smm, 0).getDate())) + ' ' + MS[smm - 1] + ' ' + sy : cap(mLabel(sm));
  return '<div class="ob-row" data-kind="' + kind + '" data-i="' + i + '">' +
    '<input class="input" data-f="label" value="' + esc(r.label) + '" maxlength="80" placeholder="' + (ep ? 'Nom du compte' : 'À quoi ça correspond') + '" aria-label="' + (ep ? 'Nom du compte' : 'Libellé') + '">' +
    '<input class="input amt" data-f="amount" value="' + esc(r.amount) + '" inputmode="decimal" placeholder="' + (ep ? 'Solde' : '0') + ' €" aria-label="' + (ep ? 'Solde actuel' : 'Montant') + '" autocomplete="off">' +
    '<button type="button" class="icon-btn" data-ob="del" aria-label="Retirer">' + ico('close') + '</button>' +
    (ep
      ? '<div class="more"><label>Versement automatique (facultatif)<input class="input amt" data-f="auto" value="' + esc(r.auto) + '" inputmode="decimal" placeholder="0 €" autocomplete="off"></label><label>Fréquence' + freq() + '</label></div>'
      : '<div class="more"><label>Fréquence' + freq() + '</label><label>À partir de' + pick('start', startTxt, 'À partir de') + '</label></div>' +
        (kind === 'rev' && OB.pro ? '<label class="check ob-urssaf"><span>Soumis à l\'URSSAF<small>Ton chiffre d\'affaires. Pas la CAF, une pension ou un salaire.</small></span><input type="checkbox" data-f="urssaf"' + (r.urssaf ? ' checked' : '') + '></label>' : '')) +
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
  } else if (id === 'compte') {
    // Patch 3 : solde du compte courant (facultatif), daté d'aujourd'hui.
    const L = OB.redo ? lastSolde() : null;
    h = '<h2>Ton compte en banque</h2><p>Combien as-tu sur ton compte en banque aujourd\'hui ? L\'appli prévoira ce qu\'il te restera à la fin du mois. Facultatif : tu peux passer cette étape.</p>' +
      (L ? '<p class="ob-done">Dernier solde noté : ' + esc(eur(Number(L.montant) || 0)) + ' le ' + esc(dShort(L.date)) + '.</p>' : '') +
      '<div class="sd-row"><div class="seg sd-sign" role="group" aria-label="Signe"><button type="button" data-ob="sign" data-n="0" aria-pressed="' + !OB.soldeNeg + '">+</button><button type="button" data-ob="sign" data-n="1" aria-pressed="' + OB.soldeNeg + '">−</button></div>' +
      '<div class="amount-wrap small"><input id="o-solde" inputmode="decimal" placeholder="0,00" autocomplete="off" value="' + esc(OB.solde) + '" aria-label="Montant sur ton compte, en euros"><span>€</span></div></div>' +
      '<p class="hint">Au ' + esc(dShort(TODAY) + ' ' + TODAY.slice(0, 4)) + ' (aujourd\'hui). Touche « − » si ton compte est à découvert.</p>';
  } else if (id === 'epargne') {
    h = '<h2>Ton épargne</h2><p>Veux-tu suivre ce que tu mets de côté (Livret A, PEL…) ? Ce que tu épargnes est retiré du reste du mois.</p>' +
      '<div class="seg"><button type="button" data-ob="ep" data-v="1" aria-pressed="' + (OB.ep === true) + '">Oui, la suivre</button><button type="button" data-ob="ep" data-v="0" aria-pressed="' + (OB.ep === false) + '">Non merci</button></div>' +
      (OB.ep ? '<p class="hint">Ajoute tes comptes avec leur solde actuel. Un versement automatique (facultatif) sera compté tout seul.</p>' +
        '<div class="chips">' + OB_QUICK.ep.map(l => '<button type="button" data-ob="add" data-k="ep" data-l="' + esc(l) + '">' + esc(l) + '</button>').join('') +
        '<button type="button" class="add" data-ob="add" data-k="ep" data-l="">+ Autre compte</button></div>' +
        '<div class="ob-rows">' + OB.comptes.map((r, i) => obRowHtml('ep', r, i)).join('') + '</div>' : '');
  } else if (id === 'apparence') {
    h = '<h2>L\'apparence</h2><p>Réglée pour cet appareil. Tu la retrouves dans Réglages → Apparence.</p>' +
      '<p class="h3">Couleur d\'accentuation</p><div class="palette accents">' + accentDots(OB.accent, 'data-ob="accent"') + '</div>' +
      '<p class="h3">Thème</p><div class="seg seg3">' + [['auto', 'Automatique'], ['clair', 'Clair'], ['sombre', 'Sombre']].map(([k, l]) => '<button type="button" data-ob="theme" data-t="' + k + '" aria-pressed="' + (APP.theme === k) + '">' + l + '</button>').join('') + '</div>' +
      '<label class="check"><span>Noir absolu<small>En mode sombre, fond noir avec de légers reflets (écrans OLED).</small></span><input type="checkbox" data-ob="noir"' + (APP.noir ? ' checked' : '') + '></label>' +
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
  if (id === 'compte' && String(OB.solde).trim() && !(parseAmount(OB.solde) >= 0)) return 'Écris le montant, par exemple 1 250,40 (ou passe l\'étape).';
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
  else if (id === 'compte') { OB.solde = ''; OB.soldeNeg = false; }
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
    // Patch 3 : un revenu fixe d'auto-entrepreneur peut être « soumis à l'URSSAF » (client régulier).
    const urssaf = type === 'revenu' && OB.pro && r.urssaf === true;
    const ref = doc(ucol(r.freq === 'mois' ? 'recurring' : 'periodiques'));
    const data = r.freq === 'mois' ? { type, label, amount, urssaf, start, end: null, createdAt: now + n++ } : { type, label, amount, urssaf, freq: r.freq, start, end: null, createdAt: now + n++ };
    // Le fixe et son jour (patch 3) partent ensemble : jamais l'un sans l'autre.
    if (r.jour) { const b = writeBatch(db); b.set(ref, data); b.set(doc(ucol('jours'), ref.id), { jour: r.jour, createdAt: now }); jobs.push(b.commit()); }
    else jobs.push(setDoc(ref, data));
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
  if (String(OB.solde).trim() && parseAmount(OB.solde) >= 0) {
    const a = parseAmount(OB.solde);
    jobs.push(addDoc(ucol('soldes'), { montant: OB.soldeNeg ? -a : a, date: TODAY, createdAt: now + n++ }));
  }
  const st = { pro: OB.pro, periodicite: OB.pro ? OB.period : (OB.redo ? S.settings.periodicite : 'mensuelle') };
  const yr = NOW.getFullYear(), rate = parseAmount(OB.rate);
  if (OB.pro && (!OB.redo || !isPro() || rate !== rateFor(yr) || S.settings.taux[yr] == null)) st.taux = { [String(yr)]: rate };
  if (OB.ep !== null) st.epargne = !!OB.ep;
  if (!OB.redo ? OB.accent !== 'bleu' : OB.accent !== S.settings.accent) st.accent = OB.accent;
  if (OB.drive && !(OB.redo && bkCfg().drive)) st.sauvegarde = { drive: true, frequence: 'mensuelle', derniere: 0 };
  if (!OB.redo) { st.createdAt = serverTimestamp(); S.justOnboarded = true; lsSet('pf-nouveautes', NOTES_VERSION); }
  // Les opérations d'abord, les réglages ensuite : l'appli s'ouvre avec tout ce qui vient d'être saisi.
  jobs.push(setDoc(uref('meta', 'settings'), st, { merge: true }));
  write(Promise.all(jobs), OB.redo ? 'Configuration enregistrée' : 'Bienvenue sur P-Flow');
  if (OB.redo) {
    OB.redo = false; OB.busy = false; show('app');
    S.view = 'mois'; S.sub = null; S.month = CUR; S.year = NOW.getFullYear();
    try { history.replaceState(null, '', '#mois'); } catch (e) { /* ignoré */ }
    ensureYearSub(); render(); requestAnimationFrame(() => positionIndicator(false));
  }
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
    else if (OB.redo) { OB.redo = false; applyColors(); show('app'); render(); requestAnimationFrame(() => positionIndicator(false)); }
  } else if (a === 'pro') { OB.pro = b.dataset.pro === '1'; obRender(0); if (OB.pro) { const r = $('#o-rate'); if (r) r.focus(); } }
  else if (a === 'period') { OB.period = b.dataset.p; obRender(0); }
  else if (a === 'sign') { OB.soldeNeg = b.dataset.n === '1'; $$('#ob-step [data-ob="sign"]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }
  else if (a === 'ep') { OB.ep = b.dataset.v === '1'; if (!OB.ep) OB.comptes = []; obRender(0); }
  else if (a === 'add') {
    const k = b.dataset.k, list = OB[k === 'ep' ? 'comptes' : k];
    list.push(k === 'ep' ? { label: b.dataset.l, amount: '', auto: '', freq: 'mois' } : { label: b.dataset.l, amount: '', freq: 'mois', start: CUR, urssaf: false });
    obRender(0);
    const rows = $$('#ob-step .ob-row'), last = rows[rows.length - 1];
    if (last) { riseIn(last); const f = b.dataset.l ? $('[data-f="amount"]', last) : $('[data-f="label"]', last); if (f) f.focus(); }
  } else if (a === 'del') {
    const row = b.closest('.ob-row'), k = row.dataset.kind;
    OB[k === 'ep' ? 'comptes' : k].splice(+row.dataset.i, 1); obRender(0);
  } else if (a === 'freq' || a === 'start') {
    const row = b.closest('.ob-row'), k = row.dataset.kind, r = OB[k === 'ep' ? 'comptes' : k][+row.dataset.i]; if (!r) return;
    const redraw = () => { obRender(0); const nb = $('#ob-step .ob-row[data-kind="' + k + '"][data-i="' + row.dataset.i + '"] [data-ob="' + a + '"]'); if (nb) nb.focus({ preventScroll: true }); };
    if (a === 'freq') openChoice({ anchor: b, label: 'Fréquence', value: r.freq, options: Object.keys(FREQ).map(f => ({ v: f, label: FREQ_WORD[f] })), onPick: v => { r.freq = v; redraw(); } });
    else openCalendar({ anchor: b, mode: 'date', label: 'Départ du fixe', note: 'Le jour où il passe sur ton compte', value: (YM_RE.test(r.start || '') ? r.start : CUR) + '-' + pad(r.jour || 1), onPick: v => { r.start = v.slice(0, 7); r.jour = +v.slice(8, 10); redraw(); } });
  } else if (a === 'theme') { setAppearance('theme', b.dataset.t); obRender(0); }
  else if (a === 'texte') { setAppearance('texte', b.dataset.t); obRender(0); }
  else if (a === 'accent') { if (isAccent(b.dataset.a)) { OB.accent = b.dataset.a; setAccent(OB.accent); obRender(0); } }
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
  if (t.id === 'o-solde') { OB.solde = t.value; return; }
  const row = t.closest('.ob-row'); if (!row || !t.dataset.f || t.type === 'checkbox') return;
  const r = OB[row.dataset.kind === 'ep' ? 'comptes' : row.dataset.kind][+row.dataset.i];
  if (r) r[t.dataset.f] = t.value;
});
$('#s-onboard').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.ob === 'noir') { setAppearance('noir', t.checked); return; }
  const row = t.closest('.ob-row'); if (!row || !t.dataset.f) return;
  const r = OB[row.dataset.kind === 'ep' ? 'comptes' : row.dataset.kind][+row.dataset.i];
  if (r) r[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
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

// Barre du haut transparente : dès qu'on fait défiler, un léger fondu garde l'heure et la batterie lisibles.
const topBar = $('.top');
let topScrolled = false;
window.addEventListener('scroll', () => {
  const s = window.scrollY > 4;
  if (s !== topScrolled) { topScrolled = s; topBar.classList.toggle('scrolled', s); }
  liveBgScroll();
}, { passive: true });

/* ----- fond vivant (patch 4) ----- */
// De temps en temps (pas en continu), les deux reflets colorés du fond dérivent et respirent lentement, puis
// reviennent à leur place. Seulement quand l'appli est visible et au repos : jamais pendant un défilement, un
// changement d'écran ou de mois (mis en pause, repris après), une fenêtre ouverte ou en arrière-plan, pour ménager
// la batterie et le flou des pilules.
// transform / opacity sur des calques à part (jamais le dégradé). Coupé par « Effets réduits ».
const LIVE = { t: 0, r: 0, anims: [], last: 0 };
function liveBgSchedule(ms) { clearTimeout(LIVE.t); LIVE.t = setTimeout(liveBgRun, ms); }
function liveBgBusy() {
  return document.hidden || !S.ready || $('#app').hidden || Date.now() - LIVE.last < 1500 || popOpen() || layerOpen(bg) || layerOpen(pbg);
}
function liveBgRun() {
  if (!motionOK()) { liveBgSchedule(20000); return; }
  // Une dérive en cours (peut-être mise en pause par un défilement ou l'arrière-plan) : la reprendre si tout est calme.
  const cur = LIVE.anims.filter(a => a.playState !== 'finished');
  if (cur.length) { if (!liveBgBusy()) cur.forEach(a => { if (a.playState === 'paused') a.play(); }); liveBgSchedule(4000); return; }
  if (liveBgBusy()) { liveBgSchedule(4000); return; }
  const rnd = () => Math.random() * 2 - 1, dur = 7000 + Math.random() * 3000;
  const drift = (el, d, delay) => anim(el, [
    { transform: 'none', opacity: 1 },
    { transform: 'translate(' + (rnd() * 4).toFixed(2) + '%,' + (rnd() * 3).toFixed(2) + '%) scale(' + (1.05 + Math.random() * 0.07).toFixed(3) + ')', opacity: 0.82, offset: 0.5 },
    { transform: 'none', opacity: 1 },
  ], { duration: d, delay, easing: 'ease-in-out' });
  LIVE.anims = [drift($('.glow .b1'), dur, 0), drift($('.glow .b2'), dur * 0.9, 500)].filter(Boolean);
  liveBgSchedule(dur + 9000 + Math.random() * 9000);
}
function liveBgScroll() {
  LIVE.last = Date.now();
  if (!LIVE.anims.length) return;
  LIVE.anims.forEach(a => { if (a.playState === 'running') a.pause(); });
  clearTimeout(LIVE.r);
  LIVE.r = setTimeout(() => { if (!liveBgBusy()) LIVE.anims.forEach(a => { if (a.playState === 'paused') a.play(); }); else liveBgScroll(); }, 1600);
}
document.addEventListener('visibilitychange', () => {
  LIVE.anims.forEach(a => { if (document.hidden && a.playState === 'running') a.pause(); else if (!document.hidden && a.playState === 'paused' && Date.now() - LIVE.last > 1500) a.play(); });
});

const ico = (id, cls) => '<svg class="i' + (cls ? ' ' + cls : '') + '"><use href="#i-' + id + '"/></svg>';
function renderCtx() {
  const c = $('#ctx');
  let h;
  // Pilules en verre : le titre (avec ses flèches) et, dans une sous-page des réglages, le retour.
  if (S.view === 'mois') {
    h = '<div class="pill"><button class="icon-btn" data-act="prev-month" aria-label="Mois précédent">' + ico('left') + '</button><h1><button type="button" class="mtitle" data-act="month-cal" aria-haspopup="dialog" aria-expanded="' + (CAL.open ? 'true' : 'false') + '" aria-label="' + esc(cap(mLabel(S.month))) + ', ouvrir le calendrier du mois">' + esc(cap(mLabel(S.month))) + '</button></h1><button class="icon-btn" data-act="next-month" aria-label="Mois suivant">' + ico('right') + '</button></div>';
  } else if (S.view === 'annee') {
    h = '<div class="pill"><button class="icon-btn" data-act="prev-year" aria-label="Année précédente">' + ico('left') + '</button><h1><button type="button" class="mtitle" data-act="year-pick" aria-haspopup="dialog" aria-expanded="' + (YP.open ? 'true' : 'false') + '" aria-label="' + S.year + ', choisir une autre année">' + S.year + '</button></h1><button class="icon-btn" data-act="next-year" aria-label="Année suivante">' + ico('right') + '</button></div>';
  } else if (S.view === 'reglages' && S.sub) {
    h = '<button class="pill back" data-act="sub-back" aria-label="Retour aux réglages">' + ico('left') + '</button><div class="pill solo"><h1>' + esc(SUBS[S.sub]) + '</h1></div>';
  } else {
    h = '<div class="pill solo"><h1>' + (S.view === 'fixes' ? 'Charges et revenus fixes' : 'Réglages') + '</h1></div>';
  }
  c.innerHTML = h;
  // Patch 4 : choix de l'année ouvert pendant un nouveau rendu (synchronisation) : la fenêtre reste calée sur la pilule.
  const yb = YP.open && popOpen() && popBox();
  if (yb && yb.querySelector('.cal-months [data-y]') && S.view === 'annee') setPopAnchor($('#ctx .mtitle'));
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
  // Patch 4 : icône aux couleurs choisies (comme les pastilles du calendrier) : revenus, revenus sans URSSAF,
  // dépenses, fixes et épargne ; la flèche garde le sens (rentrée ou sortie).
  const fixe = it.kind === 'rec' || it.kind === 'per';
  const icCls = isEp ? 'ep' : fixe ? 'fix' : isRev ? (isPro() && !it.urssaf ? 'aut' : 'in') : 'out';
  const ic = '<span class="row-ico ' + icCls + '">' + ico(isEp ? 'epargne' : isRev ? 'in' : 'out') + '</span>';
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
// Dépenses jusqu'au jour J inclus d'un mois : fixes en entier (comptés dès le début du mois) + opérations datées
// jusqu'à ce jour. Sert à comparer le mois en cours au mois d'avant « à date égale » (patch 3).
function depUntil(d, day) {
  let t = 0;
  for (const it of d.items) {
    if (it.type === 'revenu') continue;
    if (it.kind === 'entry' && +String(it.date || '').slice(8, 10) > day) continue;
    t += Number(it.amount) || 0;
  }
  return r2(t);
}
function heroSubHtml(d, m) {
  const parts = [];
  if (m > CUR) return '<span>Seulement tes fixes et ce que tu as déjà noté pour ce mois.</span>';
  if (m === CUR) {
    const dim = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate(), left = dim - NOW.getDate() + 1;
    // Patch 4 : en gardant l'objectif de fin de mois (la carte « Fin du mois » dit ce qu'il manque).
    const av = finView(m, d, null).avail;
    if (av > 0) parts.push('Tu peux encore dépenser <b>~' + esc(eur0(av / left)) + '</b> ' + (left > 1 ? 'par jour jusqu\'au ' + dim + ' ' + MONTHS[NOW.getMonth()] : 'aujourd\'hui'));
    // Patch 3 : le message dit la vraie raison (l'épargne peut faire passer le mois en négatif sans dépenser trop).
    else if (d.reste < 0 && d.ep > 0 && r2(d.net - d.dep) >= 0) parts.push('Avec ce que tu as mis de côté, il manque <b>' + esc(eur(-d.reste)) + '</b> ce mois-ci');
    else if (d.reste < 0) parts.push('Tes dépenses dépassent tes revenus ce mois-ci');
  }
  const c = cmpPart(d, m);
  if (c) parts.push(c);
  return parts.map(p => '<span>' + p + '</span>').join('');
}
// « Dépenses : +12 % par rapport au 23 septembre » (vide si le mois d'avant n'est pas chargé ou sans dépenses).
function cmpPart(d, m) {
  const pm = addM(m, -1);
  if (entCovered(pm)) { // le mois d'avant doit être chargé pour comparer
    const p = monthData(pm), mo = MONTHS[pYM(pm).m - 1];
    // Mois en cours : comparaison à date égale (« par rapport au 23 septembre »), sinon mois entiers.
    let a = d.dep, b = p.dep, ref = 'à ' + mo;
    if (m === CUR) {
      const day = NOW.getDate(), pd = Math.min(day, new Date(pYM(pm).y, pYM(pm).m, 0).getDate());
      a = depUntil(d, day); b = depUntil(p, pd); ref = 'au ' + (pd === 1 ? '1er' : pd) + ' ' + mo;
    }
    if (b > 0 && a > 0) {
      const pct = Math.round((a - b) / b * 100);
      return pct === 0 ? 'Dépenses : comme ' + (m === CUR ? 'au ' + ref.slice(3) : 'en ' + mo)
        : 'Dépenses : <span class="' + (pct > 0 ? 'up' : 'down') + '">' + (pct > 0 ? '+' : MINUS) + Math.abs(pct) + ' %</span> par rapport ' + ref;
    }
  }
  return '';
}
// Sous le gros chiffre, avec un solde noté : le solde noté (avec sa date), le prévu d'aujourd'hui s'il a changé,
// le point le plus bas, ce qu'on peut encore dépenser.
function soldeSubHtml(sv, d, m) {
  const parts = [], end = m + '-' + pad(dimOf(m)), left = dimOf(m) - NOW.getDate() + 1;
  // Patch 4 (retour sur l'APK 65) : le montant noté porte sa date (« Solde du 23 octobre »), pas « Aujourd'hui » ;
  // s'il s'est passé quelque chose depuis, on ajoute ce qui est prévu aujourd'hui.
  const L = sv.L, noted = r2(Number(L.montant) || 0), notedToday = L.date === TODAY;
  const neg = v => (v < 0 ? ' class="neg"' : '');
  parts.push((notedToday ? 'Solde d\'aujourd\'hui' : 'Solde du ' + dShort(L.date) + (L.date.slice(0, 4) !== TODAY.slice(0, 4) ? ' ' + L.date.slice(0, 4) : '')) + ' : <b' + neg(noted) + '>' + esc(eur(noted)) + '</b>');
  if (sv.today !== null && !notedToday && r2(sv.today) !== noted) parts.push('Prévu aujourd\'hui : <b' + neg(sv.today) + '>' + esc(eur(sv.today)) + '</b>');
  if (sv.low !== null && sv.lowDate !== end && sv.low < sv.end) parts.push('Point le plus bas : <b' + (sv.low < 0 ? ' class="neg"' : '') + '>' + esc(eur(sv.low)) + '</b> le ' + esc(dShort(sv.lowDate)));
  if (sv.today !== null && sv.today < 0) parts.push('<span class="warn">Ton compte est à découvert aujourd\'hui</span>');
  else if (sv.firstNeg) parts.push('<span class="warn">Attention : ton compte passerait sous 0 le ' + esc(dShort(sv.firstNeg)) + '</span>');
  else {
    // Patch 4 : sans compter l'URSSAF déjà due (payée le mois suivant) ni l'objectif de fin de mois.
    const av = finView(m, d, sv).avail;
    if (av > 0) parts.push('Tu peux encore dépenser <b>~' + esc(eur0(av / left)) + '</b> ' + (left > 1 ? 'par jour jusqu\'au ' + esc(dShort(end)) : 'aujourd\'hui'));
  }
  const c = cmpPart(d, m);
  if (c) parts.push(c);
  return parts.map(p => '<span>' + p + '</span>').join('') + soldeLinkHtml(m);
}
function soldeLinkHtml(m) {
  if (m !== CUR || S.readOnly) return '';
  const L = lastSolde();
  // Patch 4 : solde trop ancien (avant octobre de l'an dernier, opérations plus chargées) : la prévision ne s'affiche
  // plus plutôt que d'être fausse ; on le dit.
  const lost = L && ready() && !soldeView(m);
  return '<span><button type="button" class="link sm" data-act="solde-open">' + (lost ? 'Note ton solde pour voir la prévision de ton compte' : L ? 'Mettre à jour mon solde' : 'Noter ce que tu as sur ton compte') + '</button></span>';
}
// Explication d'une ligne de la cascade (petit ⓘ, patch 3) : une phrase simple, avec les vrais chiffres du mois.
function casInfoText(k, d, pro) {
  const u = pro && S.settings ? urssafPeriod(d.m) : null;
  const dl = u ? u.dl.getDate() + ' ' + MONTHS[u.dl.getMonth()] : '';
  const pay = u && u.pay && u.pay.payee ? u.pay : null;
  const T = {
    brut: 'Ce que tu as facturé ce mois-ci, avant l\'URSSAF : seulement les revenus marqués « soumis à l\'URSSAF ».',
    urssaf: pay ? (isQuarterly() ? 'Ta part de l\'URSSAF du trimestre réellement payée (' + eur(pay.montant) + ' le ' + dShort(pay.date) + '), répartie selon ce que tu as facturé chaque mois. L\'estimation était de ' + eur(d.urssafEst) + ' pour ce mois.'
      : 'Le montant que tu as réellement payé le ' + dShort(pay.date) + '. L\'estimation à ' + pctf(d.rate) + ' était de ' + eur(d.urssafEst) + '.')
      : 'Ta part URSSAF sur ce chiffre d\'affaires (' + pctf(d.rate) + '). Elle est retirée dès maintenant, alors qu\'elle se paie' + (dl ? ' avant le ' + dl : ' plus tard') + '.',
    autres: 'Ce que tu as reçu sans URSSAF : CAF, France Travail, pension, remboursements…',
    net: pro ? 'Ce qui te reste de tes revenus une fois l\'URSSAF retirée.' : 'Tout ce qui est rentré ce mois-ci : ce que tu as noté et tes revenus fixes.',
    dep: 'Tout ce qui est sorti ce mois-ci : tes dépenses notées et tes charges fixes.',
    ep: d.ep < 0 ? 'Ce que tu as repris de ton épargne ce mois-ci, moins ce que tu as mis de côté : cet argent revient dans ton mois.'
      : 'Ce que tu as mis de côté ce mois-ci, moins ce que tu as repris : cet argent n\'est plus disponible pour le mois.',
    reste: d.reste < 0 ? 'Ce qu\'il manque pour finir le mois : tes dépenses et ton épargne dépassent tes revenus nets.'
      : 'Ce qu\'il te reste une fois tout retiré : revenus nets, moins dépenses, moins épargne.',
  };
  return T[k] || '';
}
function cascadeHtml(d, ok, pro, on) {
  const apresDep = r2(d.net - d.dep);
  // Profil auto-entrepreneur : « Revenus bruts » = revenus soumis à l'URSSAF seulement (d.base), pour que le %
  // se lise sur la bonne somme ; les revenus sans URSSAF ont leur propre ligne (patch 3). Calculs inchangés.
  const autres = pro ? r2(d.brut - d.base) : 0;
  const lo = Math.min(0, apresDep, d.reste), hi = Math.max(pro ? d.base : d.brut, d.net, 0);
  const X = v => (hi - lo > 0 ? (v - lo) / (hi - lo) * 100 : 0);
  const bar = (cls, a, b) => {
    const x1 = X(Math.min(a, b)), x2 = X(Math.max(a, b));
    return '<span class="cb">' + (lo < 0 ? '<span class="zero" style="left:' + X(0).toFixed(2) + '%"></span>' : '') +
      (x2 - x1 > 0.01 ? '<i class="' + cls + '" style="left:' + x1.toFixed(2) + '%;width:' + (x2 - x1).toFixed(2) + '%"></i>' : '') + '</span>';
  };
  const rows = [];
  const R = (op, sw, label, v, b, k, cls, note) => rows.push({ op, sw, label, v, b, k, cls, note });
  if (pro) {
    const apresU = r2(d.base - d.urssaf);
    R('', 's-brut', 'Revenus bruts', d.base, bar('s-brut', 0, d.base), 'brut');
    // Patch 4 : montant réellement payé (noté avec « URSSAF payée ? ») à la place de l'estimation.
    R(MINUS, 's-urssaf', d.urssafReel ? 'URSSAF' : 'URSSAF (' + pctf(d.rate) + ')', d.urssaf, bar('s-urssaf', apresU, d.base), 'urssaf', '', d.urssafReel ? (isQuarterly() ? 'part du montant réel' : 'montant réel') : '');
    if (autres > 0) R('+', 's-autres', 'Autres revenus', autres, bar('s-autres', apresU, d.net), 'autres', '', 'sans URSSAF');
    R('=', 's-net', 'Revenus nets', d.net, bar('s-net', 0, d.net), 'net', 'sub');
  } else R('', 's-net', 'Revenus', d.brut, bar('s-net', 0, d.brut), 'net');
  // Patch 3 : la ligne dit la part des fixes (la liste dessous ne montre que les dépenses ponctuelles).
  const fixDep = sumOf(d.recs.concat(d.pers).filter(i => i.type !== 'revenu'));
  R(MINUS, 's-dep', 'Dépenses', d.dep, bar('s-dep', apresDep, d.net), 'dep', '', fixDep > 0 ? 'dont ' + eur(fixDep) + ' de fixes' : '');
  if (on) R(d.ep < 0 ? '+' : MINUS, 's-ep', d.ep < 0 ? 'Épargne reprise' : 'Épargne', Math.abs(d.ep), bar('s-ep', d.reste, apresDep), 'ep');
  const neg = d.reste < 0;
  R('=', neg ? 's-manque' : 's-reste', neg ? 'Il manque' : 'Reste', Math.abs(d.reste), bar(neg ? 's-manque' : 's-reste', 0, d.reste), 'reste', 'tot');
  return rows.map(r => {
    const open = S.casInfo === r.k;
    return '<div' + (r.cls ? ' class="' + r.cls + '"' : '') + '><dt><span class="op">' + r.op + '</span><i class="sw ' + r.sw + '"></i>' +
      '<span class="cl">' + esc(r.label) + (r.note && ok ? '<small>' + esc(r.note) + '</small>' : '') + '</span>' +
      '<button type="button" class="cinfo" data-act="cas-info" data-k="' + r.k + '" aria-expanded="' + open + '" aria-label="Explication : ' + esc(r.label) + '">' + ico('info') + '</button></dt>' +
      '<dd>' + (ok ? eur(r.v) : '…') + '</dd>' + (ok ? r.b : '') +
      (open && ok ? '<p class="cexp">' + esc(casInfoText(r.k, d, pro)) + '</p>' : '') + '</div>';
  }).join('');
}
function renderMois() {
  const m = S.month, ok = ready(), d = monthData(m), pro = isPro(), on = epOn();
  const bt = $('#back-today');
  bt.hidden = m === CUR; bt.textContent = 'Revenir à ' + MONTHS[pYM(CUR).m - 1];
  const amt = $('#hero-amount'), fut = m > CUR;
  // Patch 3 : avec un solde noté, le mois en cours affiche « Prévu sur ton compte le 31 » (le reste du mois
  // reste dans la cascade). Mois à venir : une prévision (fixes et opérations déjà notées), en gris.
  // Patch 3 : un interrupteur permet de compter le solde noté ou non (estimation), propre à l'appareil.
  const useCompte = lsGet('pf-vue-compte') !== '0';
  const anyView = ok && m >= CUR ? soldeView(m) : null;
  const hm = $('#hero-mode');
  hm.hidden = !anyView;
  if (anyView) $$('button', hm).forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'compte') === useCompte)));
  const sv = useCompte && m === CUR ? anyView : null;
  if (sv) {
    $('#hero-label').textContent = 'Prévu sur ton compte le ' + dShort(m + '-' + pad(dimOf(m)));
    amt.className = 'big' + (sv.end < 0 ? ' neg' : ' pos');
    setHero(sv.end);
    $('#hero-sub').innerHTML = soldeSubHtml(sv, d, m);
  } else {
    $('#hero-label').textContent = fut ? 'Prévu pour ' + MONTHS[pYM(m).m - 1] : 'Reste du mois';
    amt.className = 'big' + (ok ? (fut ? ' fut' : d.reste < 0 ? ' neg' : ' pos') : '');
    if (ok) setHero(d.reste); else { amt.textContent = '…'; heroVal = null; }
    // Mois à venir avec un solde noté : ce qui est prévu sur le compte à la fin de ce mois-là.
    const fv = useCompte && fut ? anyView : null;
    $('#hero-sub').innerHTML = ok ? heroSubHtml(d, m) + (fv ? '<span>Sur ton compte le ' + esc(dShort(m + '-' + pad(dimOf(m)))) + ' : <b' + (fv.end < 0 ? ' class="neg"' : '') + '>' + esc(eur(fv.end)) + '</b></span>' : '') + soldeLinkHtml(m) : '<span>Chargement…</span>';
  }
  $('#legend').innerHTML = cascadeHtml(d, ok, pro, on);
  // Patch 4 : l'offre d'épargne perd son « Nouveau » au bout d'un mois, puis se range après quelques ouvertures
  // (le choix reste dans Réglages → Mon compte et mon profil).
  const eo = epOffer();
  $('#ep-offer').hidden = !(ok && S.settings.epargne === null && !on && !S.readOnly && eo.show);
  $('#ep-offer-title').textContent = eo.fresh ? 'Nouveau : suis ton épargne' : 'Suis ton épargne';
  // Patch 4 : « URSSAF payée ? » et carte « Fin du mois » (objectif, épargne possible).
  if (pro) renderUrsAsk(ok); else $('#urs-ask').hidden = true;
  renderFinCard(m, d, useCompte && m === CUR ? anyView : null, ok);
  if (pro) renderUrssaf(m, ok);
  if (on) renderEpCard(d, ok);
  refreshMonthCal();

  const lists = $('#lists');
  if (!ok) { lists.innerHTML = '<p class="empty">Chargement…</p>'; return; }
  // Patch 3 : revenus et dépenses fixes rangés pareil, à part dans une ligne repliable ; les listes du mois ne
  // montrent que ce qui a été noté à la main (« ponctuels »).
  const revs = d.ents.filter(i => i.type === 'revenu').sort(byDate);
  const revR = d.recs.concat(d.pers).filter(i => i.type === 'revenu').sort((a, b) => b.amount - a.amount);
  const depE = d.ents.filter(i => i.type !== 'revenu').sort(byDate);
  const depR = d.recs.concat(d.pers).filter(i => i.type !== 'revenu').sort((a, b) => b.amount - a.amount);
  const epI = d.eps.concat(d.autos).sort(byDate);
  let h = '';
  h += '<section class="group"><div class="group-head"><h3>Revenus ponctuels</h3><span class="sum">' + (revs.length ? '+' + eur(sumOf(revs)) : '') + '</span></div>' +
    (revs.length ? revs.map(i => rowHtml(i, d.rate)).join('') : '<p class="empty">' + (revR.length ? 'Aucun autre revenu noté pour ' + esc(mLabel(m)) + '.' : 'Aucun revenu noté pour ' + esc(mLabel(m)) + '. Ajoute-le avec <b>+</b> puis « Revenu ».') + '</p>') + '</section>';
  if (revR.length) {
    h += '<section class="group"><button class="group-head" data-act="toggle-fixed-rev" aria-expanded="' + S.showFixedRev + '"><span class="gh-left">' + ico('right', 'chev') + '<span class="h3">Revenus fixes · ' + revR.length + '</span></span><span class="sum">+' + eur(sumOf(revR)) + '</span></button>' +
      (S.showFixedRev ? revR.map(i => rowHtml(i, d.rate)).join('') : '') + '</section>';
  }
  h += '<section class="group"><div class="group-head"><h3>Dépenses ponctuelles</h3><span class="gh-tools">' +
    (depE.length > 1 ? '<button class="toggle-mini" data-act="group-toggle" aria-pressed="' + S.grouped + '" title="Regrouper par libellé" aria-label="' + (S.grouped ? 'Triées par libellé' : 'Triées par date') + '">' + ico(S.grouped ? 'group' : 'list') + '<span class="tm-t">' + (S.grouped ? 'Par libellé' : 'Par date') + '</span></button>' : '') +
    '<span class="sum">' + (depE.length ? MINUS + eur(sumOf(depE)) : '') + '</span></span></div>' +
    (depE.length ? (S.grouped ? groupedHtml(depE, d.rate) : depE.map(i => rowHtml(i, d.rate)).join('')) : '<p class="empty">Aucune dépense notée. Ajoute-la avec <b>+</b> : tu écris toi-même à quoi elle correspond.</p>') + '</section>';
  if (depR.length) {
    h += '<section class="group"><button class="group-head" data-act="toggle-fixed" aria-expanded="' + S.showFixed + '"><span class="gh-left">' + ico('right', 'chev') + '<span class="h3">Charges fixes · ' + depR.length + '</span></span><span class="sum">' + MINUS + eur(sumOf(depR)) + '</span></button>' +
      (S.showFixed ? depR.map(i => rowHtml(i, d.rate)).join('') : '') + '</section>';
  }
  if (on && epI.length) {
    const epTot = r2(comptes(m).reduce((a, c) => a + c.solde, 0));
    h += '<section class="group"><div class="group-head"><h3>Épargne du mois</h3><span class="sum">' + (d.ep ? (d.ep > 0 ? MINUS : '+') + eur(Math.abs(d.ep)) : '') + '</span></div>' +
      '<p class="group-note">Total sur tes comptes' + esc(m === CUR ? '' : ' ' + (m < CUR ? 'à la fin ' : 'prévu à la fin ') + deMois(pYM(m).m - 1)) + ' : <b>' + esc(eur(epTot)) + '</b></p>' + epI.map(i => rowHtml(i, d.rate)).join('') + '</section>';
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
  const paid = !!(u.pay && u.pay.payee);
  const past = u.dl < today0, soon = !paid && !past && u.total > 0 && (u.dl - NOW) < 15 * 864e5;
  const dlTxt = u.dl.getDate() + ' ' + MONTHS[u.dl.getMonth()] + ' ' + u.dl.getFullYear();
  const line = $('#urssaf-line');
  line.innerHTML = '<i class="sw s-urssaf"></i><span class="t"><b>' + (ok ? eur(u.total) : '…') + '</b><span>' + esc(u.title) + (u.sub ? ' (' + esc(u.sub) + ')' : '') + ' · ' +
    (paid ? 'payée le ' + esc(dShort(u.pay.date)) : past ? 'échéance passée' : 'avant le ' + esc(u.dl.getDate() + ' ' + MONTHS[u.dl.getMonth()])) + '</span></span>' + ico('down', 'chev');
  line.classList.toggle('late', soon);
  line.setAttribute('aria-expanded', String(S.ucOpen));
  $('#urssaf-card').hidden = !S.ucOpen;
  if (!S.ucOpen) return;
  // Patch 4 : payée (date et montant réels, à modifier), ou bouton pour la noter payée.
  const est = r2(u.est) !== r2(u.total) ? ' (estimation : ' + eur(u.est) + ')' : '';
  $('#uc-info').innerHTML =
    '<p class="uc-amount">' + (ok ? eur(u.total) : '…') + '</p>' +
    '<p class="hint">' + (ok ? (paid ? 'Montant réellement payé' + esc(est) : u.base > 0 ? 'Sur ' + eur(u.base) + " de chiffre d'affaires" + (u.rate != null ? ' à ' + pctf(u.rate) : '') : "Aucun chiffre d'affaires noté pour cette période.") : '') + '</p>' +
    (paid ? '<p class="uc-due">Payée le ' + esc(dShort(u.pay.date) + ' ' + u.pay.date.slice(0, 4)) + '</p>'
      : '<p class="uc-due' + (soon ? ' late' : '') + '">' + (past ? 'Échéance passée : ' : 'À déclarer et payer au plus tard le ') + esc(dlTxt) + '</p>') +
    // Seulement pour une période déjà commencée (on ne paie pas l'URSSAF d'un mois à venir).
    (ok && !S.readOnly && (isQuarterly() ? quarterMonths(m)[0] : m) <= CUR ? '<div><button type="button" class="btn ghost sm" data-act="up-open" data-m="' + esc(m) + '">' + ico('check') + (paid ? 'Modifier le paiement' : 'Je l\'ai payée') + '</button></div>' : '');
  $('#sim').hidden = !S.simOpen; $('#sim-btn').setAttribute('aria-expanded', String(S.simOpen));
  if (S.simOpen) calc();
}
function renderEpCard(d, ok) {
  const cs = comptes(d.m), total = r2(cs.reduce((a, c) => a + c.solde, 0)), mo = MONTHS[pYM(d.m).m - 1];
  const when = epWhen(d.m);
  const mline = [d.epIn ? 'mis de côté ' + eur(d.epIn) : '', d.epOut ? 'repris ' + eur(d.epOut) : ''].filter(Boolean).join(' · ');
  $('#ep-card').innerHTML = '<div class="ep-head"><h3>Épargne' + (when ? ' <span class="ep-when">' + esc(when) + '</span>' : '') + '</h3><span class="ep-total">' + (ok ? eur(total) : '…') + '</span></div>' +
    '<p class="ep-explain">Total de tes comptes à la fin du mois : le dernier montant noté avec « J\'ai actuellement », plus ce que tu as mis de côté, moins ce que tu as repris.</p>' +
    (mline ? '<p class="ep-month">En ' + esc(mo) + ' : ' + esc(mline) + '</p>' : '') +
    (cs.length ? '<div>' + cs.map(c => '<button class="row" data-act="compte-open" data-k="' + esc(c.key) + '"><span class="row-ico ep">' + ico('epargne') + '</span><span class="row-main"><span class="row-label">' + esc(c.label) + '</span>' +
      (c.autos.length ? '<span class="row-meta">' + esc(c.autos.map(p => eur(p.amount) + ' ' + FREQ_LABEL[p.freq]).join(' · ')) + '</span>' : '') + '</span><span class="row-amt">' + eur(c.solde) + '</span></button>').join('') + '</div>'
      : '<p class="empty">Aucun compte pour l\'instant : touche <b>Épargne</b> pour noter ce que tu as ou ce que tu mets de côté.</p>');
}

/* ----- « URSSAF payée ? » (patch 4) ----- */
// Échéance d'une période (fin du mois suivant, ou du mois qui suit le trimestre).
function perDeadline(m) {
  const { y, m: mm } = pYM(m);
  if (isQuarterly()) return [new Date(y, 3, 30), new Date(y, 6, 31), new Date(y, 9, 31), new Date(y + 1, 0, 31)][quarterOf(m)];
  return new Date(y, mm + 1, 0);
}
// Période à demander : échéance passée depuis moins de 2 mois, pas encore notée payée, la plus ancienne d'abord.
// « Pas encore » la met de côté jusqu'au lendemain (clé locale `pf-urs-plus-tard` = 'AAAA-MM-JJ|période,période…' :
// en déclaration mensuelle, deux périodes peuvent attendre en même temps ; chacune reste mise de côté pour la journée).
function ursSnoozed() {
  const [d, ids] = String(lsGet('pf-urs-plus-tard') || '').split('|');
  return new Set(d === TODAY && ids ? ids.split(',') : []);
}
function urssafToAsk() {
  if (!isPro() || !S.settings || S.readOnly) return null;
  const snoozed = ursSnoozed(), lim = addD(TODAY, -62), seen = new Set();
  for (let k = 6; k >= 1; k--) {
    const x = addM(CUR, -k), id = perId(x);
    if (seen.has(id)) continue;
    seen.add(id);
    const dl = ymd(perDeadline(x));
    if (dl > TODAY || dl < lim || !entCovered(x) || snoozed.has(id)) continue;
    const u = urssafPeriod(x);
    if (u.pay && u.pay.payee) continue;
    if (!u.pay && !(u.total > 0)) continue; // rien d'estimé : rien à demander
    return Object.assign({ m: x }, u);
  }
  return null;
}
function renderUrsAsk(ok) {
  const el = $('#urs-ask'), u = ok && S.month === CUR ? urssafToAsk() : null;
  el.hidden = !u;
  if (!u) return;
  el.innerHTML = '<div class="offer-ico urs">' + ico('calc') + '</div><div class="stack-s">' +
    '<p><b>URSSAF ' + esc(u.short) + ' payée ?</b></p>' +
    '<p class="hint">Estimation : ' + esc(eur(u.est)) + ' · échéance le ' + esc(dShort(ymd(u.dl))) + '. Note ce que tu as vraiment payé : tes calculs et ton compte seront justes.</p>' +
    '<div class="btn-row"><button type="button" class="btn primary sm" data-act="up-open" data-m="' + esc(u.m) + '">Oui, payée</button><button type="button" class="btn ghost sm" data-act="up-later" data-id="' + esc(u.id) + '">Pas encore</button></div></div>';
}
const dayTxt = v => (v === TODAY ? 'Aujourd\'hui, ' : '') + dShort(v) + ' ' + v.slice(0, 4);
const UP = { m: CUR, id: '', date: TODAY, armed: false };
function openPay(m) {
  if (blocked() || !isPro() || !YM_RE.test(m || '')) return;
  const u = urssafPeriod(m), p = u.pay && u.pay.payee ? u.pay : null, dl = ymd(u.dl);
  Object.assign(UP, { m, id: u.id, armed: false, date: p ? p.date : dl <= TODAY ? dl : TODAY });
  openPanel(u.title + (u.sub ? ' (' + u.sub + ')' : ''),
    '<p class="hint">Note ce que tu as vraiment payé : ce montant remplace l\'estimation dans tes calculs, l\'écran Année et ce qui est prévu sur ton compte.</p>' +
    '<p class="hint">Estimation : ' + esc(eur(u.est)) + ' · échéance le ' + esc(dShort(dl) + ' ' + dl.slice(0, 4)) + '</p>' +
    '<div class="field"><span class="field-label">Montant payé</span><div class="amount-wrap small"><input id="up-amount" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Montant payé, en euros" value="' + esc(amountStr(p ? p.montant : u.est)) + '"><span>€</span></div></div>' +
    '<div class="field"><span class="field-label">Payée le</span><button type="button" class="input pick" data-act="up-date" aria-haspopup="dialog" aria-expanded="false"><span id="up-date-txt">' + esc(dayTxt(UP.date)) + '</span>' + ico('mois') + '</button></div>' +
    '<p class="error" id="up-error" role="alert"></p>' +
    '<div><button type="button" class="btn primary block" data-act="up-save">Enregistrer</button></div>' +
    (p ? '<div><button type="button" class="btn ghost block" data-act="up-del">Retirer ce paiement</button></div><p class="hint">Sans paiement noté, l\'appli reprend l\'estimation.</p>' : ''));
}
function savePay() {
  if (blocked()) return;
  const a = parseAmount($('#up-amount').value);
  if (!(a >= 0)) { $('#up-error').textContent = 'Indique le montant payé, par exemple 212,40.'; return; }
  const old = S.urssafPay.find(x => x.id === UP.id);
  // Fusion : un champ ajouté plus tard par une version plus récente n'est jamais effacé.
  write(setDoc(doc(ucol('urssaf'), UP.id), { payee: true, date: UP.date, montant: r2(a), createdAt: (old && Number(old.createdAt)) || Date.now() }, { merge: true }), 'Paiement de l\'URSSAF noté');
  closePanel();
}
function delPay(t) {
  if (blocked()) return;
  if (!UP.armed) { UP.armed = true; t.classList.add('armed'); t.textContent = 'Confirmer : revenir à l\'estimation'; return; }
  const old = S.urssafPay.find(x => x.id === UP.id);
  closePanel();
  if (!old) return;
  write(deleteDoc(doc(ucol('urssaf'), old.id)));
  toastUndo('Paiement retiré', () => { if (!blocked()) write(setDoc(doc(ucol('urssaf'), old.id), plain(old)), 'Remis comme avant'); });
}
function payLater(id) {
  if (blocked() || !id) return;
  if (!paiementOf(id)) write(setDoc(doc(ucol('urssaf'), id), { payee: false, createdAt: Date.now() }, { merge: true }));
  const ids = ursSnoozed(); ids.add(id);
  lsSet('pf-urs-plus-tard', TODAY + '|' + [...ids].join(','));
  toast('D\'accord : elle reste mise de côté, je te redemande demain');
  renderMois();
}

/* ----- objectif de fin de mois et épargne possible (patch 4) ----- */
// URSSAF déjà due à la fin du mois m mais pas encore retirée de ce qui est prévu sur le compte à cette date
// (son échéance tombe après) : cet argent n'est ni à dépenser ni à mettre de côté.
// `late` = jour où une URSSAF « pas encore payée » est comptée, le même que dans soldeMoves (aujourd'hui, ou le
// lendemain si le solde est daté d'aujourd'hui).
function urssafDue(m, late) {
  if (!isPro() || !S.settings) return 0;
  const end = m + '-' + pad(dimOf(m)), lt = late || TODAY;
  let t = 0;
  for (let k = 0; k <= 3; k++) {
    const x = addM(m, -k), dl = ymd(perDeadline(x)), p = paiementOf(perId(x));
    const out = p && p.payee ? p.date : p ? (dl > lt ? dl : lt) : dl; // jour où elle quitte le compte prévu
    if (out > end) t += monthData(x).urssaf;
  }
  return r2(t);
}
// Ce qu'on peut encore dépenser ou mettre de côté dans le mois m en gardant son objectif :
// avec un solde noté, prévu le dernier jour − objectif − URSSAF due, sans jamais passer sous 0 d'ici là ;
// sans solde, le reste du mois − objectif.
function finView(m, d, sv) {
  const obj = objectifOf(m) || 0;
  if (sv) {
    const D0 = sv.L && sv.L.date, late = D0 && !(TODAY > D0) ? addD(D0, 1) : TODAY;
    const due = urssafDue(m, late), byEnd = r2(sv.end - due - obj), low = sv.low != null ? sv.low : sv.end;
    return { compte: true, obj, due, byEnd, low, lowDate: sv.lowDate, end: sv.end, avail: r2(Math.min(byEnd, low)), byLow: low < byEnd };
  }
  return { compte: false, obj, due: 0, avail: r2(d.reste - obj) };
}
function renderFinCard(m, d, sv, ok) {
  const el = $('#fin-card');
  el.hidden = !(ok && m >= CUR && S.settings);
  if (el.hidden) return;
  const own = S.settings.objectifs[m] != null, obj = objectifOf(m), mo = MONTHS[pYM(m).m - 1];
  let h = '<div class="ep-head"><h3>Fin du mois</h3></div>' +
    '<button class="row" data-act="obj-open" data-m="' + esc(m) + '"' + (S.readOnly ? ' disabled' : '') + '><span class="row-ico">' + ico('target') + '</span><span class="row-main">' +
    '<span class="row-label">' + (obj != null ? 'Objectif de fin de mois' : 'Fixer un objectif de fin de mois') + '</span>' +
    '<span class="row-meta">' + (obj != null ? 'À garder sur ton compte · ' + (own ? 'seulement en ' + esc(mo) : 'tous les mois') : 'Combien veux-tu garder sur ton compte à la fin du mois ?') + '</span></span>' +
    (obj != null ? '<span class="row-amt">' + esc(eur(obj)) + '</span>' : '') + '</button>';
  if (m === CUR) {
    const f = finView(m, d, sv), can = Math.floor(f.avail);
    const parts = [];
    if (f.compte) {
      parts.push('Prévu le ' + dShort(m + '-' + pad(dimOf(m))) + ' : ' + eur(f.end));
      if (f.obj) parts.push('ton objectif ' + eur(f.obj));
      if (f.due) parts.push('URSSAF à payer ' + eur(f.due));
    } else {
      parts.push('Reste du mois : ' + eur(d.reste));
      if (f.obj) parts.push('ton objectif ' + eur(f.obj));
    }
    const how = parts.join(' − ') + (f.compte && f.byLow && can > 0 ? '. Limité par ton point le plus bas (' + eur(f.low) + ' le ' + dShort(f.lowDate) + ').' : '.');
    if (can > 0) {
      h += '<div class="fin-ep"><p>Tu peux mettre de côté <b>~' + esc(eur0(can)) + '</b> ce mois-ci</p><p class="ep-month">' + esc(how) + '</p>' +
        (epOn() && !S.readOnly ? '<div><button type="button" class="btn primary sm" data-act="ep-suggest" data-amount="' + can + '">' + ico('epargne') + 'Mettre de côté</button></div>' : '') + '</div>';
    } else if (f.compte && f.low < 0) {
      // Le compte passe sous 0 d'ici la fin du mois (le gros chiffre le signale déjà) : rien à proposer.
      h += '<div class="fin-ep"><p class="ep-month">Rien à mettre de côté : ton compte passerait sous 0 d\'ici la fin du mois.</p></div>';
    } else if (f.obj > 0 && (f.compte ? f.byEnd : f.avail) < 0) {
      h += '<div class="fin-ep"><p class="neg">Pour garder ' + esc(eur(f.obj)) + ' à la fin du mois, il manque <b>' + esc(eur(-(f.compte ? f.byEnd : f.avail))) + '</b></p><p class="ep-month">' + esc(how) + '</p></div>';
    } else {
      h += '<div class="fin-ep"><p class="ep-month">Rien à mettre de côté pour l\'instant. ' + esc(how) + '</p></div>';
    }
  }
  el.innerHTML = h;
}
const OBJ = { m: CUR, scope: 'tous', armed: false };
function openObjectif(m) {
  if (blocked() || !YM_RE.test(m || '')) return;
  Object.assign(OBJ, { m, scope: S.settings.objectifs[m] != null ? 'mois' : 'tous', armed: false });
  openPanel('Objectif de fin de mois', objFormHtml());
  setTimeout(() => { const a = $('#obj-amount'); if (a) a.focus({ preventScroll: true }); }, 320);
}
function objScopeHint() {
  return OBJ.scope === 'mois' ? 'Seulement pour ' + mLabel(OBJ.m) + ' : les autres mois ne changent pas.'
    : 'Pour tous les mois, sauf ceux que tu as réglés à part.';
}
function objFormHtml() {
  const m = OBJ.m, cur = objectifOf(m), own = S.settings.objectifs[m] != null, mo = MONTHS[pYM(m).m - 1];
  return '<p class="hint">Combien veux-tu garder sur ton compte à la fin du mois, pour bien commencer le mois suivant ? L\'appli te dit ensuite ce que tu peux encore dépenser et mettre de côté.</p>' +
    '<div class="field"><span class="field-label">À garder sur ton compte</span><div class="amount-wrap small"><input id="obj-amount" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Montant à garder, en euros" value="' + (cur != null ? esc(amountStr(cur)) : '') + '"><span>€</span></div></div>' +
    '<div class="field"><span class="field-label">Pour</span><div class="seg" role="group" aria-label="Pour quels mois">' +
    '<button type="button" data-act="obj-scope" data-v="tous" aria-pressed="' + (OBJ.scope === 'tous') + '">Tous les mois</button>' +
    '<button type="button" data-act="obj-scope" data-v="mois" aria-pressed="' + (OBJ.scope === 'mois') + '">Seulement ' + esc(mo) + '</button></div>' +
    '<p class="hint" id="obj-scope-hint">' + esc(objScopeHint()) + '</p></div>' +
    '<p class="error" id="obj-error" role="alert"></p>' +
    '<div><button type="button" class="btn primary block" data-act="obj-save">Enregistrer</button></div>' +
    (cur != null ? '<div><button type="button" class="btn ghost block" data-act="obj-del">' + (own ? 'Retirer l\'objectif ' + esc(deMois(pYM(m).m - 1)) : 'Retirer l\'objectif') + '</button></div>' : '');
}
function saveObjectif() {
  if (blocked()) return;
  const a = parseAmount($('#obj-amount').value);
  if (!(a >= 0)) { $('#obj-error').textContent = 'Indique un montant, par exemple 300.'; return; }
  const m = OBJ.m;
  // « Tous les mois » depuis un mois réglé à part : ce mois-là reprend le montant de tous les mois.
  const patch = OBJ.scope === 'mois' ? { objectifs: { [m]: a } } : Object.assign({ objectif: a }, S.settings.objectifs[m] != null ? { objectifs: { [m]: null } } : {});
  write(setDoc(uref('meta', 'settings'), patch, { merge: true }), OBJ.scope === 'mois' ? 'Objectif ' + deMois(pYM(m).m - 1) + ' enregistré' : 'Objectif enregistré pour tous les mois');
  closePanel();
}
function delObjectif(t) {
  if (blocked()) return;
  if (!OBJ.armed) { OBJ.armed = true; t.classList.add('armed'); t.textContent = 'Confirmer'; return; }
  const m = OBJ.m, own = S.settings.objectifs[m] != null;
  write(setDoc(uref('meta', 'settings'), own ? { objectifs: { [m]: null } } : { objectif: null }, { merge: true }), own ? 'Objectif ' + deMois(pYM(m).m - 1) + ' retiré' : 'Objectif retiré');
  closePanel();
}

/* ----- solde du compte courant (patch 3, point 4) ----- */
// `soldes/{id}` = { montant, date, createdAt } : « le 20 octobre j'étais à −200 € » (historique jamais effacé).
// Seul compte ce qui se passe APRÈS le dernier solde noté : opérations datées après lui, fixes à leur jour,
// versements d'épargne, URSSAF à son échéance. Une opération datée avant ou le jour du solde est déjà dedans,
// sauf si on a répondu « pas encore passée » (`pointages/{id de l'opération}` = { passee: false, … }) :
// elle compte alors aujourd'hui (ou le lendemain si le solde est daté d'aujourd'hui : elle n'y est pas encore).
const addD = (d, k) => { const x = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + k); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
const dimOf = m => new Date(pYM(m).y, pYM(m).m, 0).getDate();
const dShort = d => (+d.slice(8, 10) === 1 ? '1er' : +d.slice(8, 10)) + '\u00a0' + MONTHS[+d.slice(5, 7) - 1];
function lastSolde() {
  let best = null;
  for (const x of S.soldes) {
    if (!DATE_RE.test(x.date || '') || !isFinite(Number(x.montant))) continue;
    if (!best || x.date > best.date || (x.date === best.date && (Number(x.createdAt) || 0) > (Number(best.createdAt) || 0))) best = x;
  }
  return best;
}
const pointageOf = id => S.pointages.find(p => p.id === id) || null;
// Mouvements du compte entre le solde (exclu) et la date T (incluse) : { 'AAAA-MM-JJ': montant signé }.
function soldeMoves(L, T) {
  const D0 = L.date, ev = {}, late = TODAY > D0 ? TODAY : addD(D0, 1);
  const put = (d, v) => { if (d > D0 && d <= T && v) ev[d] = r2((ev[d] || 0) + v); };
  const op = (id, date, v) => { if (date > D0) put(date, v); else { const p = pointageOf(id); if (p && p.passee === false) put(late, v); } };
  for (const e of S.entries) if (DATE_RE.test(e.date || '')) op(e.id, e.date, (e.type === 'revenu' ? 1 : -1) * (Number(e.amount) || 0));
  const on = epOn();
  if (on) for (const e of S.epargne) if ((e.op === 'depot' || e.op === 'retrait') && DATE_RE.test(e.date || '')) op(e.id, e.date, (e.op === 'retrait' ? 1 : -1) * (Number(e.amount) || 0));
  const seen = new Set(), from = soldeFrom(D0.slice(0, 7));
  // Patch 4 : l'URSSAF payée compte à sa vraie date, pour son vrai montant ; « pas encore payée » compte aujourd'hui
  // (ou à l'échéance si elle est plus tard). On remonte 3 mois de plus pour une URSSAF payée en retard après le solde.
  for (let m = addM(from, -3); m < from; m = addM(m, 1)) {
    if (!isPro() || !S.settings) break;
    const id = perId(m), p = paiementOf(id);
    if (!p || seen.has(id)) continue;
    seen.add(id);
    if (p.payee) put(p.date, -p.montant);
    else if (entCovered(m)) { const u = urssafPeriod(m), dl = ymd(u.dl); put(dl > late ? dl : late, -u.total); }
  }
  for (let m = from; m <= T.slice(0, 7); m = addM(m, 1)) {
    if (m >= D0.slice(0, 7)) {
      for (const r of S.recurring) if (r.start && r.start <= m && (!r.end || r.end >= m)) put(fixeDate(r, m), (r.type === 'revenu' ? 1 : -1) * (Number(r.amount) || 0));
      for (const p of S.periodiques) {
        if (!perDue(p, m)) continue;
        if (p.type === 'epargne') { if (on) put(fixeDate(p, m), -(Number(p.amount) || 0)); }
        else if (p.type === 'depense' || p.type === 'revenu') put(fixeDate(p, m), (p.type === 'revenu' ? 1 : -1) * (Number(p.amount) || 0));
      }
    }
    // URSSAF : retirée du compte à son échéance (fin du mois suivant, ou du mois suivant le trimestre) ;
    // patch 4 : à la date et au montant réels si elle est notée payée, aujourd'hui au plus tôt si « pas encore ».
    if (isPro() && S.settings) {
      const id = perId(m);
      if (!seen.has(id)) {
        seen.add(id);
        const u = urssafPeriod(m), dl = ymd(u.dl), p = u.pay;
        if (p && p.payee) put(p.date, -p.montant);
        else if (p) put(dl > late ? dl : late, -u.total);
        else put(dl, -u.total);
      }
    }
  }
  return ev;
}
// Premier mois dont les opérations comptent après un solde noté en D0m : l'URSSAF du mois d'avant (ou du trimestre
// qui le contient) se paie après lui.
function soldeFrom(D0m) {
  if (!isPro() || !S.settings) return D0m;
  const p = addM(D0m, -1);
  if (S.settings.periodicite !== 'trimestrielle') return p;
  const { y, m } = pYM(p);
  return ym(y, Math.floor((m - 1) / 3) * 3 + 1);
}
// Solde prévu jour par jour pour le mois m (depuis le dernier solde) ; null sans solde ou pour un mois d'avant.
function soldeView(m) {
  const L = lastSolde(); if (!L) return null;
  const T = m + '-' + pad(dimOf(m));
  if (T < L.date) return null;
  // Opérations chargées par année (+ octobre à décembre d'avant) : sans les mois depuis le solde (et ceux dont
  // l'URSSAF se paie après lui), la prévision serait fausse. On ne l'affiche pas plutôt que de se tromper.
  if (!entCovered(soldeFrom(L.date.slice(0, 7))) || !entCovered(m)) return null;
  const ev = soldeMoves(L, T), dates = Object.keys(ev).sort();
  let bal = Number(L.montant) || 0, i = 0;
  const at = d => { while (i < dates.length && dates[i] <= d) bal = r2(bal + ev[dates[i++]]); return bal; };
  const from = TODAY > L.date ? TODAY : L.date;
  const out = { L, end: 0, today: null, low: null, lowDate: null, firstNeg: null };
  for (let d = (m + '-01' > L.date ? m + '-01' : L.date); d <= T; d = addD(d, 1)) {
    const b = at(d);
    if (d === TODAY) out.today = b;
    if (d >= from && d.slice(0, 7) === m) {
      if (out.low === null || b < out.low) { out.low = b; out.lowDate = d; }
      if (b < 0 && !out.firstNeg) out.firstNeg = d;
    }
  }
  out.end = at(T);
  return out;
}

/* ----- calendrier du mois (patch 3) ----- */
// Ouvert en touchant le nom du mois : pastilles par type d'opération, un jour touché = résumé de ses opérations
// (fixes compris, à leur jour) et « + » à cette date ; le nom du mois = les 12 mois pour sauter directement.
const CAL = { open: false, sel: null, view: 'days', y: 0, dir: 0 };
const WDAY = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function dayItems(m) {
  const d = monthData(m), out = {};
  const add = (day, it) => { (out[day] = out[day] || []).push(it); };
  for (const e of d.ents) add(+String(e.date).slice(8, 10), Object.assign({ dot: e.type === 'revenu' ? 'in' : 'out' }, e));
  for (const f of d.recs.concat(d.pers)) add(+fixeDate(f, m).slice(8, 10), Object.assign({ dot: 'fix' }, f));
  for (const e of d.eps) add(+String(e.date).slice(8, 10), Object.assign({ dot: 'ep' }, e));
  for (const a of d.autos) add(+fixeDate(a, m).slice(8, 10), Object.assign({ dot: 'ep' }, a));
  // URSSAF à payer ce mois-ci (déclaration du mois ou du trimestre précédent), le jour de l'échéance ;
  // patch 4 : le jour où elle a été payée (montant réel), même si c'est avant l'échéance ou en retard.
  if (isPro() && S.settings) {
    const seen = new Set();
    for (let k = 0; k <= 4; k++) {
      const x = addM(m, -k), id = perId(x);
      if (seen.has(id)) continue;
      seen.add(id);
      const p = paiementOf(id);
      if (!(p && p.payee) && !entCovered(x)) continue;
      const u = urssafPeriod(x), when = p && p.payee ? p.date : ymd(u.dl);
      if (when.slice(0, 7) === m && u.total > 0) add(+when.slice(8, 10), { dot: 'urs', kind: 'urs', label: u.title, paid: !!(p && p.payee), amount: u.total });
    }
  }
  return out;
}
function monthCalHtml() {
  const m = S.month, { y, m: mm } = pYM(m);
  const icon = id => ico(id);
  if (CAL.view === 'months') {
    const cy = CAL.y || y;
    return '<div class="cal-head"><button type="button" class="icon-btn" data-mc="prevy" aria-label="Année précédente">' + icon('left') + '</button><span class="cal-title static">' + cy + '</span><button type="button" class="icon-btn" data-mc="nexty" aria-label="Année suivante">' + icon('right') + '</button></div>' +
      '<div class="cal-months">' + MS.map((s, i) => '<button type="button" class="cal-m' + (cy === y && i + 1 === mm ? ' sel' : '') + (ym(cy, i + 1) === CUR ? ' today' : '') + '" data-mc="m" data-m="' + ym(cy, i + 1) + '" aria-label="' + MONTHS[i] + ' ' + cy + '">' + cap(s) + '</button>').join('') + '</div>' +
      '<div class="cal-foot"><span></span><button type="button" class="link" data-mc="m" data-m="' + CUR + '">Ce mois-ci</button></div>';
  }
  const items = ready() ? dayItems(m) : {}, n = new Date(y, mm, 0).getDate(), first = (new Date(y, mm - 1, 1).getDay() + 6) % 7;
  let h = '<div class="cal-head"><button type="button" class="icon-btn" data-mc="prev" aria-label="Mois précédent">' + icon('left') + '</button>' +
    '<button type="button" class="cal-title" data-mc="months" aria-label="Choisir un autre mois">' + esc(cap(mLabel(m))) + icon('down') + '</button>' +
    '<button type="button" class="icon-btn" data-mc="next" aria-label="Mois suivant">' + icon('right') + '</button></div>';
  h += '<div class="cal-grid mcal" role="grid">' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(w => '<span class="cal-wd" aria-hidden="true">' + w + '</span>').join('');
  for (let i = 0; i < first; i++) h += '<span></span>';
  for (let d = 1; d <= n; d++) {
    const its = items[d] || [], kinds = ['in', 'out', 'fix', 'ep', 'urs'].filter(k => its.some(i => i.dot === k));
    const v = m + '-' + pad(d);
    h += '<button type="button" class="cal-d' + (CAL.sel === d ? ' sel' : '') + (v === TODAY ? ' today' : '') + '" data-mc="day" data-d="' + d + '" aria-label="' + d + ' ' + MONTHS[mm - 1] + (its.length ? ', ' + plural(its.length, 'opération') : '') + '">' +
      '<span>' + d + '</span><span class="dots" aria-hidden="true">' + kinds.map(k => '<i class="cdot d-' + k + '"></i>').join('') + '</span></button>';
  }
  h += '</div><div class="cal-legend" aria-hidden="true"><span><i class="cdot d-in"></i>Rentrée</span><span><i class="cdot d-out"></i>Dépense</span><span><i class="cdot d-fix"></i>Fixe</span>' +
    (epOn() ? '<span><i class="cdot d-ep"></i>Épargne</span>' : '') + (isPro() ? '<span><i class="cdot d-urs"></i>URSSAF</span>' : '') + '</div>';
  if (CAL.sel) {
    const d = CAL.sel, its = items[d] || [], dt = new Date(y, mm - 1, d), date = m + '-' + pad(d), rate = its.length ? monthData(m).rate : 0;
    const row = it => {
      if (it.kind === 'urs') return '<div class="row static"><span class="row-ico urs">' + icon('calc') + '</span><span class="row-main"><span class="row-label">' + esc(it.label) + '</span><span class="row-meta">' + (it.paid ? 'payée ce jour-là' : 'à payer au plus tard ce jour-là') + '</span></span><span class="row-amt">' + MINUS + eur(it.amount) + '</span></div>';
      return rowHtml(it, rate);
    };
    h += '<div class="day-bubble" role="group" aria-label="' + esc(cap(WDAY[dt.getDay()]) + ' ' + d + ' ' + MONTHS[mm - 1]) + '"><p class="db-title">' + esc(cap(WDAY[dt.getDay()]) + ' ' + (d === 1 ? '1er' : d) + ' ' + MONTHS[mm - 1]) + '</p>' +
      (its.length ? '<div>' + its.map(row).join('') + '</div>' : '<p class="empty">Rien de noté ce jour-là.</p>') +
      (S.readOnly ? '' : '<button type="button" class="btn ghost sm" data-act="add-at" data-date="' + date + '">' + icon('plus') + 'Ajouter le ' + (d === 1 ? '1er' : d) + ' ' + MONTHS[mm - 1] + '</button>') + '</div>';
  }
  return h;
}
function openMonthCal(anchor) {
  CAL.open = true; CAL.view = 'days'; CAL.y = 0; CAL.dir = 0;
  CAL.sel = S.month === CUR ? NOW.getDate() : null;
  const box = openPopover(anchor, monthCalHtml(), { label: 'Calendrier du mois', width: 360, cls: 'pop-cal pop-mcal' + (isPro() ? ' pro' : ''), onClose: () => { CAL.open = false; } });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-mc]'); if (!b) return;
    const c = b.dataset.mc;
    if (c === 'prev' || c === 'next') { CAL.sel = null; CAL.dir = c === 'prev' ? -1 : 1; setMonth(addM(S.month, CAL.dir), CAL.dir); }
    else if (c === 'months') { CAL.view = 'months'; CAL.y = pYM(S.month).y; refreshMonthCal(); }
    else if (c === 'prevy' || c === 'nexty') { CAL.y += c === 'prevy' ? -1 : 1; CAL.dir = c === 'prevy' ? -1 : 1; refreshMonthCal(); }
    else if (c === 'm') { CAL.view = 'days'; CAL.sel = b.dataset.m === CUR ? NOW.getDate() : null; closePop(); if (b.dataset.m !== S.month) setMonth(b.dataset.m, b.dataset.m > S.month ? 1 : -1); }
    else if (c === 'day') { const d = +b.dataset.d; CAL.sel = CAL.sel === d ? null : d; refreshMonthCal(); const bb = popBox() && popBox().querySelector('.day-bubble'); if (bb) riseIn(bb); }
  });
}
// Redessine le calendrier ouvert (changement de mois, données arrivées) et le recale sous la pilule du mois.
function refreshMonthCal() {
  if (!CAL.open || !popOpen()) return;
  const box = popBox(); if (!box) return;
  box.innerHTML = monthCalHtml();
  const t = $('#ctx .mtitle'); if (t) setPopAnchor(t);
  // Changement de mois (ou d'année) depuis le calendrier : la grille glisse dans le sens choisi.
  if (CAL.dir) { anim($('.cal-grid, .cal-months', box), [{ opacity: 0, transform: 'translateX(' + (CAL.dir * 22) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: SPRING }); CAL.dir = 0; }
}

// Choix de l'année (patch 3) : touche l'année en haut de l'écran Année.
const YP = { open: false };
function openYearPick(anchor) {
  YP.open = true;
  const cy = NOW.getFullYear();
  let lo = Math.min(cy - 4, S.year);
  const yearOf = v => { const n = parseInt(String(v || '').slice(0, 4), 10); return n > 1999 && n < 2100 ? n : null; };
  for (const v of [].concat(S.recurring.map(r => r.start), S.periodiques.map(p => p.start), S.epargne.map(e => e.date), S.soldes.map(x => x.date), Object.keys((S.settings && S.settings.taux) || {}))) {
    const y = yearOf(v); if (y && y < lo) lo = y;
  }
  const hi = Math.max(cy + 1, S.year), ys = [];
  for (let y = lo; y <= hi; y++) ys.push(y);
  const box = openPopover(anchor, '<p class="pop-title">Choisir l\'année</p><div class="cal-months">' + ys.map(y =>
    '<button type="button" class="cal-m' + (y === S.year ? ' sel' : '') + (y === cy ? ' today' : '') + '" data-y="' + y + '" aria-label="' + y + (y === cy ? ', cette année' : '') + '">' + y + '</button>').join('') + '</div>' +
    '<div class="cal-foot"><span></span><button type="button" class="link" data-y="' + cy + '">Cette année</button></div>', { label: 'Choisir l\'année', width: 300, cls: 'pop-cal', onClose: () => { YP.open = false; } });
  const sel = box.querySelector('.cal-m.sel'); if (sel) sel.focus({ preventScroll: true });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-y]'); if (!b) return;
    const y = +b.dataset.y; closePop();
    if (y !== S.year) setYear(y, y > S.year ? 1 : -1);
  });
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
    '<div class="fix-small"><div><span><i class="sw s-fixes"></i>Charges fixes</span><b>' + (ok ? eur(depM) : '…') + '</b></div>' +
    '<div><span><i class="sw s-net"></i>Revenus fixes' + (pro && rev.some(x => x.urssaf) ? ' nets' : '') + '</span><b>' + (ok ? eur(revM) : '…') + '</b></div>' +
    (on ? '<div><span><i class="sw s-ep"></i>Épargne auto</span><b>' + (ok ? eur(epM) : '…') + '</b></div>' : '') + '</div>';
  if (ok) rollNumber($('#fix-totals .fix-main strong'), 'fixes', left); // patch 4 : le montant défile
  const list = $('#fix-list');
  if (!ok) { list.innerHTML = '<p class="empty">Chargement…</p>'; return; }
  const row = r => {
    const isRev = r.type === 'revenu', isEp = r.kind === 'per' && r.type === 'epargne';
    const nx = r.freq !== 'mois' && active(r) ? perNext(r, CUR) : null;
    // Patch 4 : « à partir d'août » (élision), comme partout ailleurs.
    const meta = [FREQ_LABEL[r.freq], r.start > CUR ? 'à partir ' + deMS(r.start) : 'depuis ' + mShort(r.start)];
    if (r.end) meta.push('jusqu\'à ' + mShort(r.end));
    if (nx) meta.push(nx === CUR ? 'échéance ce mois-ci' : 'prochaine : ' + mLabel(nx));
    if (isRev && pro) meta.push(r.urssaf ? 'soumis URSSAF' : 'sans URSSAF');
    // Patch 4 : charges fixes dans la couleur des Fixes, revenus et épargne dans les leurs.
    const ic = '<span class="row-ico ' + (isEp ? 'ep' : isRev ? (pro && !r.urssaf ? 'aut' : 'in') : 'fix') + '">' + ico(isEp ? 'epargne' : isRev ? 'in' : 'out') + '</span>';
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
    '<div class="minis">' + (pro ? mini('s-brut', 'Revenus bruts', T.base) + mini('s-urssaf', 'URSSAF', T.urssaf) + (T.brut - T.base > 0.004 ? mini('s-autres', 'Sans URSSAF', r2(T.brut - T.base)) : '') + mini('s-net', 'Revenus nets', T.net) : mini('s-net', 'Revenus', T.brut)) +
    mini('s-dep', 'Dépenses', T.dep) + (on ? mini('s-ep', 'Mis de côté', T.ep) + mini('s-ep', 'Total épargné', yd.n ? r2(comptes(yd.counted[yd.n - 1].m).reduce((a, c) => a + c.solde, 0)) : 0) : '') + '</div>';
  if (ok) rollNumber($('#kpis .big'), 'annee', Math.abs(T.reste));
  $('#y-period').textContent = !ok || n === 0 ? '' : n === 12 ? 'Année ' + y + ' complète.' : 'De janvier à ' + MONTHS[n - 1] + ' ' + y + '. Les mois suivants sont des prévisions (fixes seulement), en pâle.';
  $('#chart-legend').innerHTML = '<span><i class="sw s-reste"></i>Reste</span><span><i class="sw" style="background:var(--neg)"></i>Manque</span>' + (ok && yd.n ? '<span><i class="dash"></i>Reste moyen ' + esc(eur0(yd.avg)) + '</span>' : '');
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
  // Patch 3 : colonne Épargne = total sur les comptes à la fin du mois, avec le mouvement du mois en petit.
  const epTot = m => r2(comptes(m).reduce((a, c) => a + c.solde, 0));
  const epCell = d => '<td>' + n0(epTot(d.m)) + (d.ep ? '<small class="ep-mv">' + (d.ep > 0 ? '+' : MINUS) + NUM0.format(Math.abs(Math.round(d.ep))) + '</small>' : '') + '</td>';
  for (const d of yd.months) {
    const cls = ['go', d.fut ? 'fut' : '', d.now ? 'now' : ''].join(' ');
    rows += '<tr class="' + cls + '" data-act="goto-month" data-month="' + d.m + '"><td><button class="cell-btn" data-act="goto-month" data-month="' + d.m + '" aria-label="' + cap(MONTHS[pYM(d.m).m - 1]) + '"><span class="m-l">' + cap(MONTHS[pYM(d.m).m - 1]) + '</span><span class="m-s">' + cap(MS[pYM(d.m).m - 1]) + '</span></button>' + (d.fut ? '<small class="prev-l">prévision</small>' : '') + '</td>' +
      '<td>' + n0(d.net) + '</td><td>' + n0(d.dep) + '</td>' + (on ? epCell(d) : '') + '<td class="' + (d.fut ? '' : (d.reste < 0 ? 'neg' : 'pos')) + '">' + n0(d.reste) + '</td></tr>';
  }
  $('#y-table').innerHTML = ok ? '<table><caption>Montants en euros, arrondis</caption><thead><tr><th>Mois</th><th>' + (pro ? 'Nets' : 'Revenus') + '</th><th>Dépenses</th>' + (on ? '<th>Épargne<small>total</small></th>' : '') + '<th>Reste</th></tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td>Total</td><td>' + n0(T.net) + '</td><td>' + n0(T.dep) + '</td>' + (on ? '<td>' + (T.ep < -0.5 ? MINUS : '+') + NUM0.format(Math.abs(Math.round(T.ep))) + '<small class="ep-mv yr">sur l\'année</small></td>' : '') + '<td class="' + (T.reste < 0 ? 'neg' : 'pos') + '">' + n0(T.reste) + '</td></tr></tfoot></table>' : '<p class="empty">Chargement…</p>';
  // Où part l'argent : 6 premiers libellés + « Autres », en % du total des dépenses.
  const TOPN = 6, top = yd.top.slice(0, TOPN), rest = yd.top.slice(TOPN), tot = T.dep || 1;
  const others = rest.length ? { k: '__autres', label: 'Autres', total: rest.reduce((a, c) => a + c.total, 0), n: rest.length } : null;
  const maxT = Math.max(top.length ? top[0].total : 0, others ? others.total : 0) || 1;
  const topRow = c => '<button class="top-row" data-act="top-open" data-k="' + esc(c.k) + '"><span class="l">' + esc(c.label) + (c.n ? '<small>' + c.n + ' libellés</small>' : c.rec ? '<small>fixe</small>' : '') + '</span>' +
    '<span class="a">' + eur(c.total) + '<small>' + Math.round(c.total / tot * 100) + ' %</small></span>' +
    '<span class="bar"><i class="' + (c.rec ? 'f' : 'p') + '" style="width:' + Math.max(2, c.total / maxT * 100).toFixed(1) + '%"></i></span></button>';
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
  // Patch 4 : ligne pointillée = reste moyen (même grandeur que les barres), plus la moyenne des dépenses.
  const hasAvg = yd.n > 0;
  let hi = Math.max(50, hasAvg ? yd.avg : 0, ...vals), lo = Math.min(0, hasAvg ? yd.avg : 0, ...vals);
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
  if (hasAvg) {
    const ya = Math.round(Y(yd.avg)) + 0.5;
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
  b.innerHTML = '<b>' + esc(cap(mLabel(d.m))) + (d.fut ? ' · prévision' : '') + '</b>' + l(isPro() ? 'Revenus nets' : 'Revenus', d.net) + l('Dépenses', d.dep) + (on ? l('Mis de côté', d.ep) + l('Total épargné', r2(comptes(d.m).reduce((a, c) => a + c.solde, 0))) : '') + l(d.reste < 0 ? 'Il manque' : 'Reste', Math.abs(d.reste)) +
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
  $('#sh-apparence').textContent = (ACCENTS.find(([k]) => k === S.settings.accent) || ACCENTS[0])[1] + ' · ' + { auto: 'thème automatique', clair: 'thème clair', sombre: 'thème sombre' }[APP.theme] + (APP.noir ? ' · noir absolu' : '') + (APP.texte === 'grand' ? ' · grand texte' : '');
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
  renderAccents();
  $$('#theme-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === APP.theme)));
  $$('#texte-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === APP.texte)));
  $('#noir-toggle').checked = APP.noir;
  $('#effets-toggle').checked = APP.effets === 'reduits';
  $('#export-btn').textContent = 'Ouvrir ' + S.year + ' dans un tableur';
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
  if (popOpen() && $('.pop-hue')) return; // sélecteur de teinte ouvert
  const c = S.settings.couleurs;
  const html = colorKeys().map(([k, label]) => {
    const name = colorName(k, label);
    const open = S.colorOpen === k, cur = c[k] || '';
    const val = cur || rgbHex(colorRGB(k));
    // Patch 3 : une couleur déjà prise par une autre ligne (ou trop proche) est bloquée.
    const taken = open ? PRESETS.map(([hex]) => (cur === hex ? '' : takenBy(hex, k))) : [];
    // Patch 4 : « Par défaut » aussi bloqué si la couleur par défaut est déjà prise par une autre ligne.
    const defBy = open && cur ? takenBy(rgbHex(defaultRGB(k)), k) : '';
    return '<div class="color-row">' +
      '<button type="button" class="color-head" data-act="color-open" data-k="' + k + '" aria-expanded="' + open + '"><i class="sw s-' + k + '"></i><span>' + esc(name) + '</span><small>' + (cur ? 'Personnalisée' : 'Par défaut') + '</small>' + ico('right', 'chev') + '</button>' +
      (open ? '<div class="palette" role="group" aria-label="Couleur : ' + esc(name) + '">' +
        PRESETS.map(([hex, n], i) => '<button type="button" class="dot' + (taken[i] ? ' taken' : '') + '" data-act="color-set" data-k="' + k + '" data-c="' + hex + '" style="background:' + hex + '" aria-label="' + n + (taken[i] ? ', déjà prise par ' + esc(taken[i]) : '') + '"' + (taken[i] ? ' disabled title="Déjà prise par ' + esc(taken[i]) + '"' : '') + ' aria-pressed="' + (cur === hex) + '"></button>').join('') +
        '<button type="button" class="dot other" data-act="color-other" data-k="' + k + '" data-v="' + (isHex(val) ? val : '#2453c4') + '" aria-label="Autre couleur" title="Autre couleur" aria-haspopup="dialog" aria-expanded="false"></button>' +
        (cur ? '<button type="button" class="link" data-act="color-reset" data-k="' + k + '"' + (defBy ? ' disabled title="Couleur par défaut déjà prise par ' + esc(defBy) + '" aria-label="Par défaut, déjà prise par ' + esc(defBy) + '"' : '') + '>Par défaut</button>' : '') +
        '</div>' + (taken.some(Boolean) ? '<p class="hint color-note">Les couleurs barrées sont déjà prises par une autre ligne : chaque ligne garde sa couleur.</p>' : '') : '') +
      '</div>';
  }).join('');
  if (box.innerHTML !== html) box.innerHTML = html;
}
// Lignes de couleur affichées : selon le profil et l'épargne.
const colorKeys = () => COLORS.filter(([k, , proOnly]) => (!proOnly || isPro()) && (k !== 'ep' || epOn()));
const colorName = (k, label) => (k === 'net' && !isPro() ? 'Revenus' : label);
// Couleur réellement affichée pour une ligne (personnalisée ou par défaut du thème), en [r, g, b].
let colorProbe = null;
function colorRGB(k) {
  if (!colorProbe) { colorProbe = document.createElement('i'); colorProbe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden'; document.body.append(colorProbe); }
  colorProbe.style.color = 'var(--c-' + k + ')';
  const m = getComputedStyle(colorProbe).color.match(/\d+(\.\d+)?/g) || [0, 0, 0];
  return m.slice(0, 3).map(Number);
}
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
// Couleur par défaut du thème pour une ligne (sans la couleur personnalisée), en [r, g, b].
function defaultRGB(k) {
  const st = document.documentElement.style, cur = st.getPropertyValue('--c-' + k);
  if (cur) st.removeProperty('--c-' + k);
  const rgb = colorRGB(k);
  if (cur) st.setProperty('--c-' + k, cur);
  return rgb;
}
const rgbHex = c => '#' + c.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
// Écart perçu entre deux couleurs (« redmean ») : en dessous de 60, on les confond facilement.
function colorGap(a, b) {
  const r = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}
// Nom de l'autre ligne qui a déjà cette couleur (ou une trop proche), sinon ''.
function takenBy(hex, k) {
  if (!isHex(hex)) return '';
  const c = hexRGB(hex);
  for (const [o, label] of colorKeys()) if (o !== k && colorGap(c, colorRGB(o)) < 60) return colorName(o, label);
  return '';
}
function setColor(k, v) {
  if (blocked()) { applyColors(); renderColors(); return; }
  if (!COLORS.some(([x]) => x === k) || (v !== null && !isHex(v))) return;
  const by = v ? takenBy(v, k) : takenBy(rgbHex(defaultRGB(k)), k);
  if (by) { toast('Cette couleur est déjà prise par « ' + by + ' » : choisis-en une autre.', true); applyColors(); renderColors(); return; }
  write(setDoc(uref('meta', 'settings'), { couleurs: { [k]: v ? v.toLowerCase() : null } }, { merge: true }));
}
// « Autre couleur » : sélecteur de teinte maison (patch 3). Aperçu en direct, enregistrement quand on valide.
function pickOtherColor(btn) {
  const k = btn.dataset.k, root = document.documentElement;
  openHue({ anchor: btn, value: btn.dataset.v, label: 'Autre couleur',
    check: hex => { const by = takenBy(hex, k); return by ? 'Trop proche de la couleur de « ' + by + ' »' : ''; },
    onInput: hex => root.style.setProperty('--c-' + k, hex),
    onPick: hex => setColor(k, hex),
    onCancel: () => applyColors() });
}
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
function epWhen(m) { return m === CUR ? '' : (m < CUR ? 'à la fin ' : 'prévu à la fin ') + deMois(pYM(m).m - 1) + ' ' + pYM(m).y; }
function openCompte(key, m) {
  m = m || CUR; // même mois que la carte Épargne touchée
  const c = (m === CUR ? comptes() : comptes(m)).find(x => x.key === key); if (!c) return;
  const evs = S.epargne.filter(e => norm(e.label) === key).map(e => Object.assign({ kind: 'ep' }, e)).sort(byDate);
  const autos = S.periodiques.filter(p => p.type === 'epargne' && norm(p.label) === key);
  openPanel(c.label, '<p class="hint">' + esc(m === CUR ? 'Solde estimé' : cap(epWhen(m))) + '</p><p class="uc-amount">' + eur(c.solde) + '</p>' +
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
    : '<button class="row" data-act="' + ROW_ACT[it.kind] + '" data-id="' + esc(it.id) + '"><span class="row-ico fix">' + ico('out') + '</span><span class="row-main"><span class="row-label">' + esc(it.label) + '<span class="tag">fixe</span></span><span class="row-meta">' + esc(cap(mLabel(it.m))) + '</span></span><span class="row-amt">' + MINUS + eur(it.amount) + '</span></button>';
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
const F = { mode: 'new', type: 'depense', op: 'depot', freq: 'once', orig: null, ctx: CUR, armed: false, uTouched: false, jour: null, datePicked: false };
const bg = $('#sheet-bg'), form = $('#sheet');
const COL = { 'edit-entry': 'entries', 'edit-rec': 'recurring', 'edit-per': 'periodiques', 'edit-ep': 'epargne' };
let lastFocus = null;
const isFixe = () => F.mode === 'edit-rec' || F.mode === 'edit-per';
function openSheet(o) {
  if (blocked()) return;
  if (popOpen()) closePop();
  if (layerOpen(pbg)) closePanel();
  lastFocus = document.activeElement;
  F.mode = o.mode; F.armed = false; F.uTouched = false; F.jour = null; F.datePicked = false; F.ctx = o.date && DATE_RE.test(o.date) ? o.date.slice(0, 7) : S.view === 'mois' ? S.month : CUR;
  $('#f-error').textContent = '';
  let start = F.ctx;
  if (o.mode === 'new') {
    F.orig = null;
    F.type = o.type === 'epargne' && !epOn() ? 'depense' : (o.type || 'depense');
    F.op = 'depot'; F.freq = o.rec ? 'mois' : 'once';
    // Patch 4 : « Mettre de côté » pré-remplit le montant proposé.
    $('#f-amount').value = o.amount > 0 ? amountStr(o.amount) : ''; $('#f-label').value = ''; $('#f-epstart').value = '';
    $('#f-date').value = o.date && DATE_RE.test(o.date) ? o.date : F.ctx === CUR ? TODAY : F.ctx + '-01';
    if (o.date) F.datePicked = true;
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
    if (isFixe()) F.jour = jourOf(it.id);
    $('#f-urssaf').checked = !!it.urssaf;
  }
  $('#f-start').value = start;
  const opening = openLayer(bg, form);
  document.body.style.overflow = 'hidden';
  syncSheet();
  // Le clavier s'ouvre une fois la fenêtre en place : les deux mouvements ne se gênent pas.
  const focusAmount = () => { if (!layerOpen(bg)) return; const a = $('#f-amount'); a.focus({ preventScroll: true }); if (o.mode !== 'new' || o.amount > 0) a.select(); };
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
  whenUi();
  $('#f-label-label').textContent = ep ? 'Sur quel compte' : 'À quoi ça correspond';
  $('#f-label').placeholder = ep ? 'Livret A, PEL, tirelire…' : rev ? 'Salaire, facture client, CAF…' : 'Loyer, courses, plein d\'essence…';
  $('#f-amount-label').textContent = ep && F.op === 'solde' ? 'Montant actuellement sur le compte' : 'Montant';
  $('#f-urssaf-row').hidden = !rev || !isPro();
  accountsUi();
  $('#sheet-title').textContent = isNew ? (ep ? 'Épargne' : once ? 'Nouvelle opération' : 'Nouveau fixe')
    : fixe ? (ep ? 'Modifier le versement' : 'Modifier le fixe') : F.mode === 'edit-ep' ? 'Modifier l\'épargne' : 'Modifier';
  // Patch 3 : un fixe déjà compté dans des mois passés s'arrête (le passé ne change pas) ; le supprimer le retire
  // aussi de ces mois-là, donc ce bouton passe après « Arrêter » et le dit clairement.
  const hist = fixe && YM_RE.test(F.orig.start || '') && F.orig.start < CUR;
  const del = $('#f-delete'); del.hidden = isNew; del.classList.remove('armed'); F.armed = false;
  del.textContent = hist ? 'Supprimer aussi des mois passés' : 'Supprimer';
  const stop = $('#f-stop');
  if (fixe) { stop.hidden = false; stop.textContent = F.orig.end ? 'Reprendre' : 'Arrêter après ' + MONTHS[pYM(F.ctx).m - 1]; }
  else stop.hidden = true;
  stop.classList.toggle('lead', hist);
  sheetHints();
  updatePreview();
  // Les suggestions dépendent du type (dépense, revenu ou compte d'épargne).
  if (document.activeElement === $('#f-label')) suggest(); else closeSuggest();
}
// Patch 3 : « Soumis à l'URSSAF » reprend le choix du dernier revenu de même libellé (une CAF reste « sans URSSAF »).
// null = libellé jamais utilisé pour un revenu (la case reste cochée d'office). Rien de nouveau n'est enregistré.
function urssafFor(label) {
  const k = fold(label); if (!k) return null;
  let best = null, t = -Infinity;
  for (const arr of [S.entries, S.recurring, S.periodiques]) for (const it of arr) {
    if (it.type !== 'revenu' || fold(it.label) !== k) continue;
    const ti = Number(it.createdAt) || 0;
    if (ti >= t) { t = ti; best = !!it.urssaf; }
  }
  return best;
}
function guessUrssaf() {
  if (F.mode !== 'new' || F.type !== 'revenu' || F.uTouched || !isPro()) return;
  const g = urssafFor($('#f-label').value);
  const v = g === null ? true : g;
  if ($('#f-urssaf').checked !== v) { $('#f-urssaf').checked = v; updatePreview(); }
}
// Phrases sous le formulaire d'un fixe. « Ce changement compte à partir de… » seulement quand quelque chose qui compte a changé
// (montant, type, URSSAF ou fréquence), pas dès qu'on ouvre le fixe pour le regarder (patch 3).
function sheetHints() {
  const hint = $('#f-hint'), hints = [];
  if (isFixe() && F.orig) {
    const o = F.orig, ended = !!o.end;
    const hist = YM_RE.test(o.start || '') && o.start < CUR;
    const a = parseAmount($('#f-amount').value);
    const urs = F.type === 'revenu' && isPro() && $('#f-urssaf').checked;
    const changed = (a > 0 && a !== Number(o.amount)) || F.type !== (o.type === 'revenu' ? 'revenu' : o.type) || urs !== !!o.urssaf
      || (F.mode === 'edit-per' && F.freq !== o.freq) || (F.mode === 'edit-rec' && F.freq !== 'mois');
    // Scission seulement si le mois de départ ne change pas (sinon le fixe est réécrit avec le nouveau départ).
    if (changed && o.start < F.ctx && (!o.end || o.end >= F.ctx) && $('#f-start').value === o.start) {
      const ns = F.mode === 'edit-rec' && F.freq === 'mois' ? F.ctx : firstDue(o.start, F.freq, F.ctx);
      hints.push('Ce changement compte ' + aPartir(ns) + '. Les mois d\'avant gardent ' + eur(o.amount) + '.');
    }
    if (ended) hints.push('Ce fixe a une date de fin : pour changer sa fréquence, touche d\'abord « Reprendre ».');
    // Le calendrier choisit le jour ET le mois de départ : prévenir si le mois de départ change (patch 3).
    const ns = $('#f-start').value;
    // Patch 4 : trimestriel ou annuel, c'est tout le cycle qui se décale (pas seulement le premier mois).
    const cyc = (f, st, en) => (f === 'annee' ? cycleTxt(st, f) : (en ? 'en ' : '') + joinFr(cycleTxt(st, f).split(', ')));
    if (YM_RE.test(ns) && YM_RE.test(o.start || '') && ns !== o.start && (F.freq === 'trimestre' || F.freq === 'annee')) {
      // « Au lieu de » seulement si l'ancien fixe était déjà trimestriel ou annuel (un mensuel n'a pas de cycle).
      const was = o.freq === 'trimestre' || o.freq === 'annee' ? cyc(o.freq, o.start, false) : '';
      const now = cyc(F.freq, ns, true);
      hints.push('Attention : ce fixe tombera désormais ' + now + (was && 'en ' + was !== now && was !== now ? ' (au lieu de ' + was + ')' : '') + ', ' + aPartir(ns) + '.' +
        (ns > o.start ? ' Il ne comptera plus ' + plusRange(o.start, addM(ns, -1)) + '.' : ' Il comptera aussi les mois d\'avant.'));
    } else if (YM_RE.test(ns) && YM_RE.test(o.start || '') && ns !== o.start) {
      hints.push(ns > o.start ?'Attention : le départ passe ' + deM(o.start) + ' à ' + mLabel(ns) + '. Ce fixe ne comptera plus ' + plusRange(o.start, addM(ns, -1)) + '. Pour garder ' + (o.start === addM(ns, -1) ? 'ce mois' : 'ces mois') + ', choisis un jour en ' + mLabel(o.start) + '.'
        : 'Le départ passe ' + deM(o.start) + ' à ' + mLabel(ns) + ' : ce fixe comptera aussi les mois d\'avant.');
    }
    if (hist && !ended) hints.push('« Arrêter » garde les mois passés comme ils sont. « Supprimer aussi des mois passés » le retire de tous les mois depuis ' + mLabel(o.start) + '.');
  }
  hint.hidden = !hints.length; hint.textContent = hints.join(' ');
}
// Patch 3 : comptes d'épargne existants en pilules (une faute de frappe créait un autre compte qui repartait de 0).
// Un nom qui n'est pas encore un compte = nouveau compte : on propose de noter ce qu'il y a déjà dessus.
function accountsUi() {
  const box = $('#f-accounts'), ep = F.type === 'epargne', field = $('#f-epstart-field');
  if (!ep) { box.hidden = true; field.hidden = true; return; }
  const cs = comptes().map(c => c.label).sort((a, b) => a.localeCompare(b, 'fr'));
  const cur = fold($('#f-label').value);
  const known = cs.some(l => fold(l) === cur);
  box.innerHTML = cs.map(l => '<button type="button" data-acc="' + esc(l) + '" aria-pressed="' + (fold(l) === cur) + '">' + esc(l) + '</button>').join('') +
    '<button type="button" class="new" data-acc="" aria-pressed="' + (!!cur && !known) + '">+ Nouveau compte</button>';
  box.hidden = false;
  field.hidden = !(F.mode === 'new' && F.op !== 'solde' && cur && !known);
}
$('#f-accounts').addEventListener('click', e => {
  const b = e.target.closest('button[data-acc]'); if (!b) return;
  const lab = $('#f-label');
  lab.value = b.dataset.acc; accountsUi();
  if (!b.dataset.acc) lab.focus();
});
function cycleTxt(start, freq) {
  if (freq === 'annee') return 'chaque ' + MONTHS[pYM(start).m - 1];
  if (freq !== 'trimestre') return '';
  const m0 = pYM(start).m - 1;
  return [0, 3, 6, 9].map(k => MS[(m0 + k) % 12]).join(', ');
}
// Phrase sous un nouveau fixe (patch 3, retour du 23/10/2026) : la fréquence et la date sont déjà affichées au-dessus,
// donc rien pour un fixe mensuel ou annuel ; pour un trimestriel, seulement les mois où il tombe.
function fixeTxt(m) {
  if (F.freq !== 'trimestre') return '';
  const ms = cycleTxt(m, 'trimestre').split(', ');
  return 'Tombe en ' + ms.slice(0, -1).join(', ') + ' et ' + ms[ms.length - 1] + '.';
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
    else if (fixeTxt(m)) say(esc(fixeTxt(m))); else p.hidden = true;
  } else if (!once && F.mode === 'new' && fixeTxt(m)) {
    say(esc(fixeTxt(m)));
  } else p.hidden = true;
}
$('#type-seg').addEventListener('click', e => { const b = e.target.closest('button[data-type]'); if (!b) return; F.type = b.dataset.type; if (F.type === 'epargne' && F.freq !== 'once' && F.op !== 'depot') F.op = 'depot'; syncSheet(); guessUrssaf(); });
$('#op-seg').addEventListener('click', e => { const b = e.target.closest('button[data-op]'); if (!b) return; F.op = b.dataset.op; syncSheet(); });
$('#freq-seg').addEventListener('click', e => {
  const b = e.target.closest('button[data-f]'); if (!b || b.disabled) return;
  const was = F.freq; F.freq = b.dataset.f;
  // Ajout : la date choisie pour « une fois » devient le départ (et le jour) du fixe, et inversement (patch 3).
  if (F.mode === 'new' && was === 'once' && F.freq !== 'once') {
    const d = $('#f-date').value;
    if (DATE_RE.test(d)) { $('#f-start').value = d.slice(0, 7); F.jour = F.datePicked ? +d.slice(8, 10) : null; }
  } else if (F.mode === 'new' && was !== 'once' && F.freq === 'once' && F.jour) {
    const st = $('#f-start').value, { y, m } = pYM(st);
    $('#f-date').value = st + '-' + pad(Math.min(F.jour, new Date(y, m, 0).getDate()));
  }
  syncSheet();
});
['#f-amount', '#f-date'].forEach(id => $(id).addEventListener('input', () => { updatePreview(); if (isFixe()) sheetHints(); }));
// Date ou départ : calendrier maison (patch 3, plus de sélecteur natif). Pour un fixe, le jour choisi est celui
// où il passe sur le compte (facultatif ; sans choix, il compte le 1er).
function whenUi() {
  const once = F.freq === 'once', lbl = $('#f-when-label'), txt = $('#f-when-txt');
  if (once) {
    const d = $('#f-date').value;
    lbl.textContent = 'Date';
    txt.textContent = DATE_RE.test(d) ? (d === TODAY ? 'Aujourd\'hui, ' : '') + (+d.slice(8, 10) === 1 ? '1er' : +d.slice(8, 10)) + ' ' + MONTHS[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4) : 'Choisir une date';
  } else {
    const st = $('#f-start').value || CUR, { y, m } = pYM(st);
    const per = F.freq === 'trimestre' || F.freq === 'annee';
    lbl.textContent = per ? 'Première échéance' : 'À partir de';
    const j = F.jour ? Math.min(F.jour, new Date(y, m, 0).getDate()) : null;
    txt.textContent = (j ? (j === 1 ? '1er' : j) + ' ' + MONTHS[m - 1] + ' ' + y : cap(mLabel(st))) + (j || F.type === 'epargne' ? '' : ' · choisis le jour');
  }
}
$('#f-when').addEventListener('click', e => {
  const once = F.freq === 'once', st = $('#f-start').value || CUR;
  openCalendar({
    anchor: e.currentTarget, mode: 'date', label: once ? 'Date de l\'opération' : 'Départ du fixe',
    value: once ? $('#f-date').value : st + '-' + pad(F.jour || 1),
    note: once ? '' : (F.type === 'epargne' ? 'Le jour du versement' : 'Le jour où il passe sur ton compte'),
    onPick: v => {
      if (F.freq === 'once') { $('#f-date').value = v; F.datePicked = true; whenUi(); updatePreview(); }
      else { $('#f-start').value = v.slice(0, 7); F.jour = +v.slice(8, 10); whenUi(); if (isFixe()) syncSheet(); else updatePreview(); }
    },
  });
});
$('#f-urssaf').addEventListener('change', () => { F.uTouched = true; updatePreview(); if (isFixe()) sheetHints(); });
$('#sheet-close').addEventListener('click', closeSheet);
bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || popOpen()) return;
  if (layerOpen(pbg)) closePanel(); else if (layerOpen(bg)) closeSheet(); else if (S.bubble != null) hideBubble();
});

form.addEventListener('submit', e => {
  e.preventDefault();
  if (blocked()) { closeSheet(); return; }
  const err = m => { $('#f-error').textContent = m; };
  const amount = parseAmount($('#f-amount').value);
  let label = $('#f-label').value.trim().replace(/\s+/g, ' ');
  const once = F.freq === 'once', ep = F.type === 'epargne';
  // Épargne : « Epargne » tapé pour le compte « Épargne » va sur ce compte (sinon un autre compte repartirait de 0).
  const known = ep && label ? comptes().find(c => fold(c.label) === fold(label)) : null;
  if (known && F.mode === 'new') label = known.label;
  const date = $('#f-date').value, startSel = $('#f-start').value;
  if (!(amount > 0 || (ep && F.op === 'solde' && amount === 0))) return err('Indique un montant supérieur à 0, par exemple 12,50.');
  if (!label) return err(ep ? 'Indique le compte, par exemple Livret A.' : 'Écris à quoi correspond ce montant.');
  if (once && !DATE_RE.test(date)) return err('Choisis une date.');
  if (!once && !YM_RE.test(startSel)) return err('Choisis le mois de départ.');
  const type = F.type, urssaf = type === 'revenu' && isPro() && $('#f-urssaf').checked;
  const mode = F.mode, o = F.orig, cm = F.ctx, f = F.freq, jour = once ? null : F.jour;
  const month = once ? date.slice(0, 7) : startSel;
  closeSheet();
  if (mode === 'new') {
    // Nouveau compte : ce qu'il y a déjà dessus devient un « J'ai actuellement » juste avant l'opération (patch 3).
    // Les deux écritures partent ensemble (writeBatch) : jamais le dépôt sans le solde de départ.
    const st = $('#f-epstart').value.trim(), stA = parseAmount(st), pre = [];
    if (ep && F.op !== 'solde' && st && stA >= 0 && !known) {
      const d0 = once ? date : TODAY; // versement automatique : ce qu'il y a dessus aujourd'hui
      pre.push([doc(ucol('epargne')), { op: 'solde', label, amount: stA, date: d0, month: d0.slice(0, 7), createdAt: Date.now() - 1 }]);
    }
    if (ep && once) {
      const ref = doc(ucol('epargne')), data = { op: F.op, label, amount, date, month, createdAt: Date.now() };
      const msg = F.op === 'solde' ? 'Solde enregistré' : F.op === 'retrait' ? 'Retrait noté' : 'Mis de côté';
      if (pre.length) { const b = writeBatch(db); pre.forEach(([r, d]) => b.set(r, d)); b.set(ref, data); write(b.commit(), msg); }
      else write(setDoc(ref, data), msg);
      if (F.op !== 'solde' && epOn()) askPassed({ id: ref.id, op: F.op, label, amount, date, createdAt: Date.now() });
    }
    else if (ep) addFixe('periodiques', { type: 'epargne', label, amount, urssaf: false, freq: f, start: month, end: null, createdAt: Date.now() }, jour, 'Versement automatique ajouté ' + aPartir(month), pre);
    else if (once) {
      const ref = doc(ucol('entries'));
      write(setDoc(ref, { type, label, amount, urssaf, date, month, createdAt: Date.now() }), (S.view === 'mois' && month !== S.month) ? 'Enregistré en ' + mLabel(month) : 'Enregistré');
      askPassed({ id: ref.id, kind: 'entry', type, label, amount, date, createdAt: Date.now() });
    }
    else if (f === 'mois') addFixe('recurring', { type, label, amount, urssaf, start: month, end: null, createdAt: Date.now() }, jour, 'Fixe ajouté ' + aPartir(month));
    else addFixe('periodiques', { type, label, amount, urssaf, freq: f, start: month, end: null, createdAt: Date.now() }, jour, 'Fixe ajouté : ' + FREQ_LABEL[f] + ' ' + aPartir(month));
  } else if (mode === 'edit-entry') {
    // Repartir du document lu : un champ ajouté par une version plus récente n'est jamais effacé.
    write(setDoc(doc(ucol('entries'), o.id), Object.assign(plain(o), { type, label, amount, urssaf, date, month, createdAt: o.createdAt || Date.now() })), 'Modifié');
    // Déplacée à une autre date : si elle tombe avant le dernier solde noté, demander si elle était déjà passée.
    if (date !== o.date) askPassed({ id: o.id, kind: 'entry', type, label, amount, date, createdAt: o.createdAt || 0, moved: true });
  } else if (mode === 'edit-ep') {
    write(setDoc(doc(ucol('epargne'), o.id), Object.assign(plain(o), { op: F.op, label, amount, date, month, createdAt: o.createdAt || Date.now() })), 'Modifié');
    if (date !== o.date && F.op !== 'solde' && epOn()) askPassed({ id: o.id, op: F.op, label, amount, date, createdAt: o.createdAt || 0, moved: true });
  } else {
    saveFixe(o, COL[mode], f, { type, label, amount, urssaf, start: startSel }, cm, jour);
  }
});
// Solde du compte (patch 3) : fenêtre pour noter ce qu'on a sur son compte, avec l'historique (jamais effacé).
const SD = { neg: false, date: TODAY };
function openSolde() {
  if (blocked()) return;
  SD.neg = false; SD.date = TODAY;
  openPanel('Mon compte en banque', soldeFormHtml());
  setTimeout(() => { const a = $('#sd-amount'); if (a) a.focus({ preventScroll: true }); }, 320);
}
function soldeFormHtml() {
  const hist = S.soldes.filter(x => DATE_RE.test(x.date || '')).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  return '<p class="hint">Note ce que tu as sur ton compte courant : l\'appli prévoit ce qu\'il restera à la fin du mois, avec tes fixes, tes opérations et l\'URSSAF à son échéance.</p>' +
    '<div class="field"><span class="field-label">Montant sur ton compte</span>' +
    '<div class="sd-row"><div class="seg sd-sign" role="group" aria-label="Signe"><button type="button" data-act="sd-sign" data-n="0" aria-pressed="' + !SD.neg + '">+</button><button type="button" data-act="sd-sign" data-n="1" aria-pressed="' + SD.neg + '">−</button></div>' +
    '<div class="amount-wrap small"><input id="sd-amount" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Montant sur ton compte, en euros"><span>€</span></div></div>' +
    '<p class="hint">« − » si ton compte est à découvert.</p></div>' +
    '<div class="field"><span class="field-label">Le</span><button type="button" class="input pick" data-act="sd-date" aria-haspopup="dialog" aria-expanded="false"><span id="sd-date-txt">' + esc((SD.date === TODAY ? 'Aujourd\'hui, ' : '') + dShort(SD.date) + ' ' + SD.date.slice(0, 4)) + '</span>' + ico('mois') + '</button></div>' +
    '<p class="error" id="sd-error" role="alert"></p>' +
    '<div><button type="button" class="btn primary block" data-act="sd-save">Enregistrer</button></div>' +
    (hist.length ? '<h3>Soldes déjà notés</h3><div>' + hist.slice(0, 24).map(x => '<div class="row static"><span class="row-main"><span class="row-label">' + esc(dShort(x.date) + ' ' + x.date.slice(0, 4)) + '</span></span><span class="row-amt' + (Number(x.montant) < 0 ? ' neg' : '') + '">' + esc(eur(Number(x.montant) || 0)) + '</span></div>').join('') + '</div>' : '');
}
function saveSolde() {
  if (blocked()) return;
  const a = parseAmount($('#sd-amount').value);
  if (!(a >= 0)) { $('#sd-error').textContent = 'Indique le montant, par exemple 1 250,40.'; return; }
  const montant = SD.neg ? -a : a, date = SD.date;
  const pend = pendingOps(date);
  write(addDoc(ucol('soldes'), { montant, date, createdAt: Date.now() }), 'Solde enregistré');
  // Patch 4 : une URSSAF « pas encore payée » l'a peut-être été depuis (le nouveau solde la contiendrait) :
  // la question « URSSAF payée ? » revient tout de suite au lieu d'attendre le lendemain.
  if (lsGet('pf-urs-plus-tard')) lsSet('pf-urs-plus-tard', '');
  closePanel();
  // Les opérations « pas encore passées » d'avant ce nouveau solde : reposer la question.
  if (pend.length) setTimeout(() => askPending(pend, date), 420);
}
// Opérations marquées « pas encore passées » datées jusqu'à d.
function pendingOps(d) {
  const out = [];
  for (const p of S.pointages) {
    if (p.passee !== false) continue;
    const e = S.entries.find(x => x.id === p.id) || S.epargne.find(x => x.id === p.id);
    if (e && e.op !== 'solde' && DATE_RE.test(e.date || '') && e.date <= d) out.push(e); // un « J'ai actuellement » ne passe pas sur le compte
  }
  return out;
}
const opTxt = e => esc(e.label) + ' · ' + esc(dShort(e.date)) + ' · ' + (e.op ? (e.op === 'solde' ? '' : e.op === 'retrait' ? '+' : MINUS) : e.type === 'revenu' ? '+' : MINUS) + esc(eur(e.amount));
// La question remplace le message « Enregistré » (il passerait sur ses boutons).
const hideToast = () => { const t = $('#toast'); if (!toastUndoFn) { clearTimeout(toastT); t.hidden = true; } };
function askPending(list, d) {
  hideToast();
  openPanel('Déjà passées sur ton compte ?', '<p class="hint">Ces opérations n\'étaient pas encore passées sur ton compte. Le sont-elles au ' + esc(dShort(d)) + ' ?</p>' +
    '<div class="pt-list">' + list.map(e => '<div class="pt-row" data-id="' + esc(e.id) + '"><span>' + opTxt(e) + '</span><span class="btn-row"><button type="button" class="btn ghost sm" data-act="pt" data-v="1" data-id="' + esc(e.id) + '">Oui</button><button type="button" class="btn ghost sm" data-act="pt" data-v="0" data-id="' + esc(e.id) + '">Pas encore</button></span></div>').join('') + '</div>');
}
// Question après l'ajout (ou le déplacement) d'une opération datée avant ou le jour du dernier solde.
function askPassed(op) {
  const L = lastSolde();
  // Appelée juste après l'ajout ou le déplacement : tout solde déjà noté est antérieur à ce geste.
  if (!L || !op || !op.id || !DATE_RE.test(op.date || '') || op.date > L.date) return;
  setTimeout(() => (hideToast(), openPanel('Déjà passée sur ton compte ?',
    '<p>' + opTxt(op) + '</p><p class="hint">Tu as noté ton solde le ' + esc(dShort(L.date)) + '. Cette opération était-elle déjà passée sur ton compte à ce moment-là ?</p>' +
    '<div class="btn-row"><button type="button" class="btn primary" data-act="pt" data-v="1" data-id="' + esc(op.id) + '" data-close="1">Oui, déjà passée</button><button type="button" class="btn ghost" data-act="pt" data-v="0" data-id="' + esc(op.id) + '" data-close="1">Non, pas encore</button></div>' +
    '<p class="hint">« Pas encore » : elle sera retirée de ce qui est prévu sur ton compte.</p>')), 420);
}
function setPointage(id, passee) {
  if (blocked()) return;
  write(setDoc(doc(ucol('pointages'), id), { passee, createdAt: Date.now() }, { merge: true }));
}
// Nouveau fixe (identifiant connu d'avance pour ranger son jour à part, collection `jours`, patch 3).
// pre : écritures liées envoyées avec (solde de départ d'un nouveau compte d'épargne).
function addFixe(col, data, jour, msg, pre) {
  const ref = doc(ucol(col)), linked = pre || [];
  if (jour || linked.length) {
    const b = writeBatch(db);
    linked.forEach(([r, d]) => b.set(r, d));
    b.set(ref, data);
    if (jour) b.set(doc(ucol('jours'), ref.id), { jour, createdAt: Date.now() });
    write(b.commit(), msg);
  } else write(setDoc(ref, data), msg);
}
// Fixes (chaque mois → `recurring` ; trimestre, année et épargne automatique → `periodiques`).
// Un changement de montant ou de fréquence en cours de route (mois de départ inchangé) garde le passé :
// l'ancien s'arrête au mois d'avant et un nouveau prend le relais (même principe qu'avant le patch 2).
// Changer le mois de départ réécrit le fixe avec ce nouveau départ (comme avant le patch 2). Les deux écritures partent
// ensemble (writeBatch) : jamais l'une sans l'autre. Aucun fixe n'est supprimé par une modification.
function saveFixe(o, src, f, vals, cm, jour) {
  // Patch 3 : le jour du fixe (jours/{id}) suit le fixe ; un nouveau document créé en cours de route le reprend.
  const j = jour || jourOf(o.id);
  // Fusion : un champ ajouté plus tard à `jours` par une version plus récente n'est jamais effacé.
  const setJour = (b, id) => { if (j && (id !== o.id || j !== jourOf(o.id))) b.set(doc(ucol('jours'), id), id === o.id && jourOf(o.id) ? { jour: j } : { jour: j, createdAt: Date.now() }, { merge: true }); };
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
      const b = writeBatch(db), nref = doc(ucol(dst));
      b.set(oldRef, Object.assign(plain(o), { label: vals.label, end: addM(cm, -1) }));
      b.set(nref, withFreq(Object.assign(plain(o), vals, { start: ns, end: o.end || null, createdAt: Date.now() }), f));
      setJour(b, nref.id);
      write(b.commit(), 'Nouveau montant ' + aPartir(ns));
    } else {
      const b = writeBatch(db);
      b.set(oldRef, withFreq(Object.assign(plain(o), vals), f));
      setJour(b, o.id);
      write(b.commit(), 'Modifié');
    }
    return;
  }
  // Changement de collection (chaque mois ↔ trimestre / année) : le passé reste compté tel qu'il était.
  // L'ancien document est gardé et arrêté juste avant le nouveau (s'il n'avait pas commencé, il s'arrête
  // avant son début : il ne compte plus nulle part, mais rien n'est effacé).
  const ns = started ? firstDue(vals.start, f, cm) : vals.start;
  const nd = withFreq(Object.assign(plain(o), vals, { start: ns, end: o.end && o.end >= ns ? o.end : null, createdAt: Date.now() }), f);
  const b = writeBatch(db), nref = doc(ucol(dst));
  b.set(nref, nd);
  b.set(oldRef, Object.assign(plain(o), { end: past ? addM(cm, -1) : addM(o.start, -1) }));
  setJour(b, nref.id);
  write(b.commit(), 'Modifié : ' + FREQ_LABEL[f] + ' ' + aPartir(ns));
}
$('#f-delete').addEventListener('click', () => {
  if (blocked()) { closeSheet(); return; }
  const b = $('#f-delete');
  if (!F.armed) { F.armed = true; b.classList.add('armed'); b.textContent = isFixe() ? 'Confirmer : retirer de tous les mois' : 'Confirmer la suppression'; return; }
  const o = F.orig, mode = F.mode, col = COL[mode]; closeSheet();
  write(deleteDoc(doc(ucol(col), o.id)));
  // « Annuler » pendant 5 s : le document revient à l'identique (même identifiant, tous ses champs, même inconnus).
  toastUndo(mode === 'edit-rec' || mode === 'edit-per' ? 'Fixe supprimé' : 'Supprimé', () => {
    if (blocked()) return;
    write(setDoc(doc(ucol(col), o.id), plain(o)), 'Remis comme avant');
  });
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
  if (F.type === 'epargne') { closeSuggest(); accountsUi(); return; } // les comptes sont en pilules (patch 3)
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
  lab.value = v; closeSuggest(); guessUrssaf();
}
lab.addEventListener('focus', suggest);
lab.addEventListener('input', () => { suggest(); guessUrssaf(); });
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
  positionNavIndicator(animate); // tablette et PC (patch 4)
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
// Patch 4 : tablette et PC, menu de gauche en pilule verticale avec le même surlignage « liquide » qui glisse.
let navY = null;
function positionNavIndicator(animate) {
  const nav = $('.side .nav'), ind = $('.nav-ind');
  if (!nav || !ind || !nav.offsetWidth) return;
  const b = $('.side .nav [data-view="' + S.view + '"]'); if (!b) return;
  const y = b.offsetTop, h = b.offsetHeight;
  ind.style.height = h + 'px';
  ind.style.transform = 'translateY(' + y + 'px)';
  if (animate && navY != null && navY !== y) {
    anim(ind, [
      { transform: 'translateY(' + navY + 'px) scaleY(1)' },
      { transform: 'translateY(' + ((navY + y) / 2) + 'px) scaleY(1.28)', offset: 0.45 },
      { transform: 'translateY(' + y + 'px) scaleY(1)' },
    ], { duration: 460, easing: 'cubic-bezier(.3,.8,.25,1)' });
  }
  navY = y;
}
// Patch 4 : entrer dans Réglages (ou en sortir) resserre (ou élargit) la pilule du bas, avec un léger effet
// « liquide » : FLIP en transform seulement (le fond en scaleX, les onglets en translateX), positions lues
// une fois avant le mouvement. Renvoie le décalage du bord gauche de la barre (pour le surlignage).
function morphTabbar(apply) {
  const bar = $('.tabbar'), bg = $('.tab-bg');
  if (!bar || !bg || !bar.offsetWidth || !motionOK()) { apply(); return 0; }
  const tabs = $$('.tabbar button[data-view]');
  const r0 = bg.getBoundingClientRect(), t0 = tabs.map(t => t.getBoundingClientRect().left);
  apply();
  const r1 = bg.getBoundingClientRect();
  if (Math.abs(r1.width - r0.width) < 1) return 0;
  const sx = r0.width / r1.width, over = 1 + (1 - sx) * 0.1;
  anim(bg, [{ transform: 'scaleX(' + sx + ')' }, { transform: 'scaleX(' + over + ')', offset: 0.68 }, { transform: 'none' }], { duration: 560, easing: 'cubic-bezier(.3,.85,.3,1)' });
  tabs.forEach((t, i) => {
    const dx = t0[i] - t.getBoundingClientRect().left;
    if (Math.abs(dx) > 0.5) anim(t, [{ transform: 'translateX(' + dx + 'px)' }, { transform: 'none' }], { duration: 560, easing: SPRING });
  });
  return r0.left - r1.left;
}
function setView(v) {
  const from = VIEWS.indexOf(S.view), to = VIEWS.indexOf(v);
  if (S.view === v && !(v === 'reglages' && S.sub)) { window.scrollTo({ top: 0, behavior: motionOK() ? 'smooth' : 'auto' }); return; }
  liveBgScroll(); // fond vivant : même pause que pendant un défilement, le temps de la transition
  S.view = v; S.sub = null; S.deferYear = v === 'annee';
  try { history.replaceState(null, '', '#' + v); } catch (e) { /* ignoré */ }
  hideBubble();
  const dx = morphTabbar(() => { $('.tabbar').dataset.view = v; });
  if (indX != null) indX += dx; // le surlignage part de là où il était à l'écran
  positionIndicator(true); // avant le rendu : la position des onglets se lit sans recalcul de la page
  ensureYearSub(); render(); window.scrollTo(0, 0);
  slideIn($('#v-' + v), to >= from ? 1 : -1);
  viewIn(v);
}
// Patch 4 : à l'arrivée sur un écran, ses blocs arrivent en cascade et les barres poussent.
function viewIn(v) {
  const V = '#v-' + v + ' ';
  cascadeIn($$(v === 'reglages' ? V + '.set-list button' : V + '.hero, ' + V + '.uc-line, ' + V + '.card, ' + V + '.page-intro'));
  if (v === 'annee') growBars($$('#chart .b-pos, #chart .b-neg'));
  if (v === 'mois') growBars($$('#legend .cb i'), 'x');
}
function setSub(name, dir) {
  S.sub = name;
  render(); window.scrollTo(0, 0);
  slideIn(name ? $('#sub-' + name) : $('#set-home'), dir, 40);
  cascadeIn(name ? $$('#sub-' + name + ' .card, #sub-' + name + ' .set-foot') : $$('#set-home .set-list button'), { dy: 10, step: 28 });
}
function setMonth(m, dir) {
  if (dir) liveBgScroll(); // fond vivant en pause pendant le glissement
  S.month = m; S.year = pYM(m).y; ensureYearSub(); render();
  if (dir) {
    slideIn($('#v-mois .month-grid'), dir, 36); slideIn($('#ctx h1'), dir, 14);
    // Patch 4 : les lignes du mois arrivent en cascade, les barres du calcul repoussent.
    cascadeIn($$('#lists .row'), { max: 8, dy: 8, step: 26 });
    growBars($$('#legend .cb i'), 'x');
  }
}
function setYear(y, dir) {
  S.year = y; S.deferYear = !!dir; ensureYearSub(); render();
  if (dir) { slideIn($('#v-annee'), dir, 30); slideIn($('#ctx h1'), dir, 14); growBars($$('#chart .b-pos, #chart .b-neg')); }
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
      if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.4) { lock = 'x'; liveBgScroll(); }
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
  else if (a === 'year-pick') openYearPick(t);
  else if (a === 'hero-mode') { lsSet('pf-vue-compte', t.dataset.v === 'reste' ? '0' : '1'); renderMois(); }
  else if (a === 'add') openSheet({ mode: 'new', rec: S.view === 'fixes' });
  else if (a === 'add-type') openSheet({ mode: 'new', type: t.dataset.type });
  else if (a === 'month-cal') { if (CAL.open && popOpen()) closePop(); else openMonthCal(t); }
  else if (a === 'add-at') openSheet({ mode: 'new', date: t.dataset.date });
  else if (a === 'solde-open') openSolde();
  else if (a === 'sd-sign') { SD.neg = t.dataset.n === '1'; $$('[data-act="sd-sign"]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); }
  else if (a === 'sd-date') openCalendar({ anchor: t, mode: 'date', label: 'Date du solde', max: TODAY, value: SD.date, onPick: v => { SD.date = v; $('#sd-date-txt').textContent = (v === TODAY ? 'Aujourd\'hui, ' : '') + dShort(v) + ' ' + v.slice(0, 4); } });
  else if (a === 'sd-save') saveSolde();
  // Patch 4 : URSSAF payée, objectif de fin de mois, épargne possible.
  else if (a === 'up-open') openPay(t.dataset.m);
  else if (a === 'up-later') payLater(t.dataset.id);
  else if (a === 'up-date') {
    const ms = isQuarterly() ? quarterMonths(UP.m)[0] : UP.m;
    openCalendar({ anchor: t, mode: 'date', label: 'Date du paiement', min: ms + '-01', max: TODAY, value: UP.date, onPick: v => { UP.date = v; $('#up-date-txt').textContent = dayTxt(v); } });
  }
  else if (a === 'up-save') savePay();
  else if (a === 'up-del') delPay(t);
  else if (a === 'obj-open') openObjectif(t.dataset.m);
  else if (a === 'obj-scope') { OBJ.scope = t.dataset.v === 'mois' ? 'mois' : 'tous'; $$('[data-act="obj-scope"]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); $('#obj-scope-hint').textContent = objScopeHint(); }
  else if (a === 'obj-save') saveObjectif();
  else if (a === 'obj-del') delObjectif(t);
  else if (a === 'ep-suggest') openSheet({ mode: 'new', type: 'epargne', amount: Number(t.dataset.amount) });
  else if (a === 'pt') {
    setPointage(t.dataset.id, t.dataset.v === '1');
    if (t.dataset.close) closePanel();
    else { const row = t.closest('.pt-row'); if (row) { row.classList.add('done'); $$('button', row).forEach(b => { b.disabled = true; b.setAttribute('aria-pressed', String(b === t)); }); } }
  }
  else if (a === 'edit-entry' || a === 'edit-rec' || a === 'edit-per' || a === 'edit-ep') openSheet({ mode: a, id: t.dataset.id });
  else if (a === 'toggle-fixed') { S.showFixed = !S.showFixed; lsSet('pf-showFixed', S.showFixed ? '1' : '0'); renderMois(); }
  else if (a === 'toggle-fixed-rev') { S.showFixedRev = !S.showFixedRev; lsSet('pf-showFixedRev', S.showFixedRev ? '1' : '0'); renderMois(); }
  else if (a === 'cas-info') { S.casInfo = S.casInfo === t.dataset.k ? null : t.dataset.k; renderMois(); if (S.casInfo) riseIn($('#legend .cexp')); }
  else if (a === 'toggle-ended') { S.showEnded = !S.showEnded; renderFixes(); }
  else if (a === 'group-toggle') { S.grouped = !S.grouped; lsSet('pf-groupe', S.grouped ? '1' : '0'); renderMois(); }
  else if (a === 'grp-open') { const k = t.dataset.k; if (S.openGroups.has(k)) S.openGroups.delete(k); else S.openGroups.add(k); renderMois(); }
  else if (a === 'urssaf-toggle') { S.ucOpen = !S.ucOpen; renderMois(); if (S.ucOpen) riseIn($('#urssaf-card')); }
  else if (a === 'sim-toggle') { S.simOpen = !S.simOpen; renderMois(); if (S.simOpen) { riseIn($('#sim')); $('#c-brut').focus(); } }
  else if (a === 'ep-offer') {
    if (blocked()) return;
    const yes = t.dataset.v === '1';
    write(setDoc(uref('meta', 'settings'), { epargne: yes }, { merge: true }), yes ? 'Épargne activée : ajoute-la avec le bouton Épargne' : 'C\'est noté. Tu pourras l\'activer dans Réglages → Mon compte.');
  } else if (a === 'compte-open') openCompte(t.dataset.k, S.view === 'mois' ? S.month : CUR);
  else if (a === 'bar') showBubble(+t.dataset.i);
  else if (a === 'top-open') openTop(t.dataset.k);
  else if (a === 'goto-month') { hideBubble(); S.month = t.dataset.month; S.year = pYM(S.month).y; setView('mois'); }
  else if (a === 'sub') setSub(t.dataset.sub, 1);
  else if (a === 'sub-back') setSub(null, -1);
  else if (a === 'sub-admin') { if (S.view !== 'reglages') setView('reglages'); setSub('admin', 1); }
  else if (a === 'theme') setAppearance('theme', t.dataset.t);
  else if (a === 'accent') {
    const ac = t.dataset.a;
    if (!isAccent(ac) || ac === S.settings.accent || blocked()) return;
    setAccent(ac); // tout de suite, sans attendre l'enregistrement
    write(setDoc(uref('meta', 'settings'), { accent: ac }, { merge: true }), 'Couleur d\'accentuation : ' + (ACCENTS.find(([k]) => k === ac) || [])[1]);
  }
  else if (a === 'texte') setAppearance('texte', t.dataset.t);
  else if (a === 'news') showNews();
  else if (a === 'redo-setup') { if (!blocked()) openOnboarding(true); }
  else if (a === 'export') exportCsv();
  // mises à jour
  else if (a === 'upd-check') checkUpdate(true);
  else if (a === 'upd-auto-open') openUpdAuto(t);
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
  else if (a === 'color-other') pickOtherColor(t);
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
  if (!S.ready || $('#app').hidden || popOpen() || layerOpen(bg) || layerOpen(pbg) || isEditable(ae) || (ae && ae.tagName === 'SELECT') || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const d = e.key === 'ArrowLeft' ? -1 : 1;
  if (S.view === 'mois') setMonth(addM(S.month, d), d);
  else if (S.view === 'annee') setYear(S.year + d, d);
});

let toastT = null, toastUndoFn = null, toastOut = null;
// Patch 4 : le message arrive comme une goutte (petit rebond) et repart en douceur ; un message qui en remplace
// un autre fait juste un petit rebond.
function toast(msg, isErr) {
  const t = $('#toast'); toastUndoFn = null; t.textContent = msg; t.classList.toggle('err', !!isErr); t.classList.remove('undo');
  if (toastOut) { toastOut.cancel(); toastOut = null; }
  if (t.hidden) { t.hidden = false; anim(t, [{ transform: 'translateX(-50%) translateY(14px) scale(.82)', opacity: 0 }, { transform: 'translateX(-50%) scale(1.03)', opacity: 1, offset: 0.6 }, { transform: 'translateX(-50%)', opacity: 1 }], { duration: 420, easing: EASE }); }
  else anim(t, [{ transform: 'translateX(-50%) scale(.95)' }, { transform: 'translateX(-50%)' }], { duration: 320, easing: SPRING });
  clearTimeout(toastT); toastT = setTimeout(hideToastSoft, isErr ? 5000 : 2200);
}
function hideToastSoft() {
  const t = $('#toast'); toastUndoFn = null;
  const a = anim(t, [{ transform: 'translateX(-50%)', opacity: 1 }, { transform: 'translateX(-50%) translateY(10px) scale(.94)', opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
  if (!a) { t.hidden = true; return; }
  toastOut = a;
  a.finished.then(() => { if (toastOut === a) { t.hidden = true; a.cancel(); toastOut = null; } }, () => {});
}
// Message avec un bouton « Annuler » (patch 3), visible 5 secondes.
function toastUndo(msg, fn) {
  toast(msg);
  const t = $('#toast');
  toastUndoFn = fn;
  t.classList.add('undo');
  t.innerHTML = '<span>' + esc(msg) + '</span><button type="button" class="toast-undo">Annuler</button>';
  clearTimeout(toastT); toastT = setTimeout(hideToastSoft, 5000);
}
$('#toast').addEventListener('click', e => {
  if (!e.target.closest('.toast-undo') || !toastUndoFn) return;
  const fn = toastUndoFn; toastUndoFn = null; clearTimeout(toastT);
  $('#toast').hidden = true; fn();
});

/* ---------- appli Android : retour et mises à jour ---------- */
if (isNative) {
  CapApp.addListener('backButton', () => {
    if (popOpen()) { closePop(); return; }
    if (layerOpen(pbg)) { closePanel(); return; }
    if (layerOpen(bg)) { closeSheet(); return; }
    if (!$('#s-onboard').hidden) {
      if (OB.step > 0) obGo(OB.step - 1);
      else if (OB.redo) { OB.redo = false; applyColors(); show('app'); render(); requestAnimationFrame(() => positionIndicator(false)); }
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
// Patch 4 : « une fois par mois » (30 jours) ; une valeur inconnue retombe sur « jour ».
const UPD_FREQ = { ouverture: 0, jour: 864e5, semaine: 7 * 864e5, mois: 30 * 864e5, jamais: Infinity };
const UPD_FREQ_LABEL = { ouverture: 'À chaque ouverture', jour: 'Une fois par jour', semaine: 'Une fois par semaine', mois: 'Une fois par mois', jamais: 'Jamais' };
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
  $('#upd-auto-txt').textContent = UPD_FREQ_LABEL[updAuto()];
  const pr = $('#upd-progress'); pr.hidden = UPD.state !== 'downloading'; pr.value = UPD.pct;
}
// Choix de la fréquence de vérification (patch 4) : une ligne qui ouvre un petit menu en verre (pilule de choix),
// même clé `pf-maj-auto` et mêmes valeurs qu'avant (réglage propre à l'appareil, rien dans Firestore).
function openUpdAuto(btn) {
  openChoice({ anchor: btn, label: 'Vérification automatique', value: updAuto(), options: Object.keys(UPD_FREQ).map(v => ({ v, label: UPD_FREQ_LABEL[v] })),
    onPick: v => { if (v in UPD_FREQ) { lsSet('pf-maj-auto', v); renderUpdate(); } } });
}
if (isNative) CapApp.addListener('appStateChange', st => { if (st && st.isActive && S.ready) maybeAutoUpdate(); });

/* ---------- sauvegardes : fichier et Google Drive ---------- */
// Une sauvegarde contient tout le compte. La restaurer remet seulement ce qui manque :
// rien n'est écrasé ni supprimé (CLAUDE.md, règle n°1). Les réglages ne sont pas modifiés.
// Format 2 (patch 2) : ajoute `periodiques` et `epargne` ; les sauvegardes format 1 se restaurent toujours.
// Format 3 (patch 3) : ajoute `jours` (jour d'un fixe), `soldes` (compte courant) et `pointages`
// (« déjà passée sur ton compte ? ») ; les versions d'avant ignorent simplement ces listes.
// Format 4 (patch 4) : ajoute `urssaf` (paiements de l'URSSAF), ignorée de même par les versions d'avant.
const BK = { busy: false, status: '', err: false, due: false, triedAuto: false, list: null, plan: null, link: null };
const BK_COLS = ['entries', 'recurring', 'periodiques', 'epargne', 'jours', 'soldes', 'pointages', 'urssaf'];
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
  const o = { app: 'P-Flow', format: 4, dataVersion: DATA_VERSION, appVersion: RAW_VERSION, exportedAt: new Date().toISOString(), settings: st.exists() ? cleanDoc(st.data()) : null };
  BK_COLS.forEach((c, i) => { o[c] = cols[i].docs.map(d => Object.assign({ id: d.id }, cleanDoc(d.data()))); });
  return o;
}
function validItem(it, kind) {
  if (!it || typeof it !== 'object' || !ID_RE.test(String(it.id))) return false;
  if (kind === 'jours') return Number.isInteger(it.jour) && it.jour >= 1 && it.jour <= 31;
  if (kind === 'soldes') return typeof it.montant === 'number' && isFinite(it.montant) && DATE_RE.test(it.date);
  if (kind === 'pointages') return typeof it.passee === 'boolean';
  if (kind === 'urssaf') return /^\d{4}-(\d{2}|T[1-4])$/.test(it.id) && (it.payee === false || (it.payee === true && typeof it.montant === 'number' && isFinite(it.montant) && it.montant >= 0 && DATE_RE.test(it.date)));
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
  if (n.soldes) parts.push(plural(n.soldes, 'solde') + ' du compte');
  if ((n.jours || 0) + (n.pointages || 0)) parts.push(plural(n.jours + n.pointages, 'détail') + ' (jours des fixes, opérations pointées)');
  if (n.urssaf) parts.push(plural(n.urssaf, 'paiement') + ' de l\'URSSAF');
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
      // Lancé depuis le bandeau : le message doit se voir partout ailleurs que dans « Mes données ».
      if (!(S.view === 'reglages' && S.sub === 'donnees')) toast(driveErr(e), true);
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
