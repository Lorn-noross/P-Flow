// Sélecteurs maison de P-Flow (patch 3) : calendrier, liste de choix et teinte, en verre, aux couleurs du thème.
// Ils remplacent les fenêtres natives d'Android (sélecteur de date, liste <select>, sélecteur de couleur) :
// voir CLAUDE.md, « Sous-interfaces aux couleurs de l'appli ».
// Une seule fenêtre à la fois, posée sous l'élément touché (ou au-dessus s'il n'y a pas la place).
// Elle se ferme en touchant à côté, avec Échap ou le bouton retour d'Android (closePop(), appelé par main.js).

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WD = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const WD_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const dim = (y, m) => new Date(y, m, 0).getDate(); // m de 1 à 12
const ICON = id => '<svg class="i"><use href="#i-' + id + '"/></svg>';

let cfg = { motionOK: () => true, today: () => new Date() };
export function initPickers(o) { cfg = Object.assign(cfg, o || {}); }

const SPRING = 'cubic-bezier(.2,1.18,.32,1)';
function anim(el, frames, opts) {
  if (!el || !el.animate || !cfg.motionOK()) return null;
  try { return el.animate(frames, opts); } catch (e) { return null; }
}

/* ---------- la fenêtre ---------- */
let P = null; // { scrim, box, anchor, onClose, width, below }
export const popOpen = () => !!P;
export function closePop(silent) {
  if (!P) return;
  const p = P; P = null;
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  const done = () => { p.scrim.remove(); p.box.remove(); };
  const a = anim(p.box, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(' + (p.below ? -6 : 6) + 'px) scale(.97)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
  if (a) a.finished.then(done, done); else done();
  if (p.anchor && p.anchor.setAttribute) p.anchor.setAttribute('aria-expanded', 'false');
  if (!silent && p.onClose) p.onClose();
  if (p.anchor && p.anchor.focus && document.contains(p.anchor)) { try { p.anchor.focus({ preventScroll: true }); } catch (e) { /* ignoré */ } }
}
function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closePop(); }
}
function onResize() { if (P) place(P); }
function place(p) {
  const box = p.box, a = p.anchor && document.contains(p.anchor) ? p.anchor.getBoundingClientRect() : null;
  const vw = window.innerWidth, vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
  const w = Math.min(p.width || 336, vw - 24);
  box.style.width = w + 'px';
  const h = box.offsetHeight;
  let x = a ? a.left + a.width / 2 - w / 2 : (vw - w) / 2;
  x = Math.max(12, Math.min(vw - w - 12, x));
  let y, below = true;
  if (!a) y = Math.max(12, (vh - h) / 2);
  else if (a.bottom + 8 + h <= vh - 12) y = a.bottom + 8;
  else if (a.top - 8 - h >= 12) { y = a.top - 8 - h; below = false; }
  else y = Math.max(12, (vh - h) / 2);
  p.below = below;
  box.style.left = Math.round(x) + 'px';
  box.style.top = Math.round(y) + 'px';
  box.style.transformOrigin = (a ? Math.round(a.left + a.width / 2 - x) : w / 2) + 'px ' + (below ? '0' : '100%');
}
function openPop(anchor, html, o) {
  closePop(true);
  const scrim = document.createElement('div');
  scrim.className = 'pop-scrim';
  const box = document.createElement('div');
  box.className = 'pop' + (o.cls ? ' ' + o.cls : '');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  if (o.label) box.setAttribute('aria-label', o.label);
  box.innerHTML = html;
  document.body.append(scrim, box);
  P = { scrim, box, anchor, onClose: o.onClose, width: o.width };
  // Fermeture au « click » (et pas dès l'appui) : le toucher entier reste sur le voile, rien ne passe à travers
  // vers l'élément du dessous, même quand le voile disparaît sans animation (effets réduits).
  scrim.addEventListener('pointerdown', e => e.preventDefault());
  scrim.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); closePop(); });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
  place(P);
  anim(box, [{ opacity: 0, transform: 'translateY(' + (P.below ? -8 : 8) + 'px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: SPRING });
  return box;
}

// Fenêtre libre (calendrier du mois de main.js) : même comportement que les autres sélecteurs.
export function openPopover(anchor, html, o) { return openPop(anchor, html, o || {}); }
export function placePop() { if (P) place(P); }
export function setPopAnchor(el) { if (P && el) { P.anchor = el; el.setAttribute('aria-expanded', 'true'); place(P); } }
export function popBox() { return P ? P.box : null; }

/* ---------- liste de choix ---------- */
// options : [{ v, label, hint? }] ; onPick(v)
export function openChoice({ anchor, options, value, label, onPick, width }) {
  const html = '<div class="pop-list" role="listbox"' + (label ? ' aria-label="' + esc(label) + '"' : '') + '>' +
    options.map(o => '<button type="button" role="option" data-v="' + esc(o.v) + '" aria-selected="' + (o.v === value) + '"><span>' + esc(o.label) +
      (o.hint ? '<small>' + esc(o.hint) + '</small>' : '') + '</span>' + ICON('check') + '</button>').join('') + '</div>';
  const box = openPop(anchor, html, { label, width: width || (anchor ? Math.max(220, anchor.getBoundingClientRect().width) : 260), cls: 'pop-choice' });
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    const v = b.dataset.v; closePop(true); onPick(v);
  });
  const sel = box.querySelector('[aria-selected="true"]') || box.querySelector('button');
  if (sel) sel.focus({ preventScroll: true });
  box.addEventListener('keydown', e => {
    const bs = Array.from(box.querySelectorAll('button[data-v]')), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (bs[i + 1] || bs[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (bs[i - 1] || bs[bs.length - 1]).focus(); }
  });
}

/* ---------- calendrier ---------- */
// mode 'date' : renvoie 'AAAA-MM-JJ' ; mode 'month' : renvoie 'AAAA-MM'.
// value : 'AAAA-MM-JJ' ou 'AAAA-MM' ; min / max : 'AAAA-MM-JJ' facultatifs (jours hors limites grisés) ;
// note : petite phrase facultative en bas du calendrier.
export function openCalendar({ anchor, value, mode, label, onPick, min, max, note }) {
  const today = cfg.today();
  const T = { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };
  const sv = String(value || '');
  const sel = { y: +sv.slice(0, 4) || T.y, m: +sv.slice(5, 7) || T.m, d: mode === 'month' ? 0 : (+sv.slice(8, 10) || 0) };
  const V = { y: sel.y, m: sel.m, view: mode === 'month' ? 'months' : 'days' };
  const ym = (y, m) => y + '-' + pad(m);
  const okMonth = (y, m) => (!min || ym(y, m) >= min.slice(0, 7)) && (!max || ym(y, m) <= max.slice(0, 7));
  const box = openPop(anchor, '', { label: label || 'Choisir une date', width: 336, cls: 'pop-cal' });
  const render = dir => {
    let h = '';
    if (V.view === 'days') {
      const first = (new Date(V.y, V.m - 1, 1).getDay() + 6) % 7, n = dim(V.y, V.m);
      h += '<div class="cal-head"><button type="button" class="icon-btn" data-c="prev" aria-label="Mois précédent">' + ICON('left') + '</button>' +
        '<button type="button" class="cal-title" data-c="months" aria-label="Choisir le mois">' + cap(MONTHS[V.m - 1]) + ' ' + V.y + ICON('down') + '</button>' +
        '<button type="button" class="icon-btn" data-c="next" aria-label="Mois suivant">' + ICON('right') + '</button></div>';
      h += '<div class="cal-grid" role="grid">' + WD.map((w, i) => '<span class="cal-wd" aria-hidden="true" title="' + WD_LONG[i] + '">' + w + '</span>').join('');
      for (let i = 0; i < first; i++) h += '<span></span>';
      for (let d = 1; d <= n; d++) {
        const v = V.y + '-' + pad(V.m) + '-' + pad(d);
        const isSel = sel.y === V.y && sel.m === V.m && sel.d === d, isT = T.y === V.y && T.m === V.m && T.d === d;
        const off = (min && v < min) || (max && v > max);
        h += '<button type="button" class="cal-d' + (isSel ? ' sel' : '') + (isT ? ' today' : '') + '" data-d="' + d + '"' + (off ? ' disabled' : '') +
          ' aria-label="' + d + ' ' + MONTHS[V.m - 1] + ' ' + V.y + (isT ? ", aujourd'hui" : '') + '"' + (isSel ? ' aria-current="date"' : '') + '>' + d + '</button>';
      }
      h += '</div>';
      h += '<div class="cal-foot">' + (note ? '<span class="hint">' + esc(note) + '</span>' : '<span></span>') + '<button type="button" class="link" data-c="today">Aujourd\'hui</button></div>';
    } else {
      h += '<div class="cal-head"><button type="button" class="icon-btn" data-c="prevy" aria-label="Année précédente">' + ICON('left') + '</button>' +
        '<span class="cal-title static">' + V.y + '</span>' +
        '<button type="button" class="icon-btn" data-c="nexty" aria-label="Année suivante">' + ICON('right') + '</button></div>';
      h += '<div class="cal-months">' + MS.map((s, i) => {
        const m = i + 1, isSel = sel.y === V.y && sel.m === m, isT = T.y === V.y && T.m === m;
        return '<button type="button" class="cal-m' + (isSel ? ' sel' : '') + (isT ? ' today' : '') + '" data-m="' + m + '"' + (okMonth(V.y, m) ? '' : ' disabled') + ' aria-label="' + MONTHS[i] + ' ' + V.y + '">' + cap(s) + '</button>';
      }).join('') + '</div>';
      if (mode === 'month') h += '<div class="cal-foot"><span></span><button type="button" class="link" data-c="thismonth">Ce mois-ci</button></div>';
    }
    box.innerHTML = h;
    if (dir) anim(box.querySelector('.cal-grid, .cal-months'), [{ opacity: 0, transform: 'translateX(' + (dir * 22) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: SPRING });
    if (P) place(P);
  };
  render(0);
  const f = box.querySelector('.cal-d.sel, .cal-m.sel, .cal-d.today, .cal-m.today');
  if (f) f.focus({ preventScroll: true });
  const shift = k => { let m = V.m + k, y = V.y; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } V.m = m; V.y = y; render(k); };
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const c = b.dataset.c;
    if (c === 'prev') shift(-1);
    else if (c === 'next') shift(1);
    else if (c === 'months') { V.view = 'months'; render(0); }
    else if (c === 'prevy') { V.y--; render(-1); }
    else if (c === 'nexty') { V.y++; render(1); }
    else if (c === 'today') { closePop(true); onPick(T.y + '-' + pad(T.m) + '-' + pad(T.d)); }
    else if (c === 'thismonth') { closePop(true); onPick(ym(T.y, T.m)); }
    else if (b.dataset.m) {
      const m = +b.dataset.m;
      if (mode === 'month') { closePop(true); onPick(ym(V.y, m)); return; }
      V.m = m; V.view = 'days'; render(0);
    } else if (b.dataset.d) { closePop(true); onPick(V.y + '-' + pad(V.m) + '-' + pad(+b.dataset.d)); }
  });
}

/* ---------- teinte ---------- */
// Petit sélecteur de couleur maison : une réglette de teinte et trois nuances. onInput(hex) pendant le choix
// (aperçu), onPick(hex) quand on valide ; fermer sans valider remet l'aperçu d'avant (onCancel).
// check(hex) facultatif : renvoie un message si la couleur n'est pas permise (déjà prise) ; « Choisir » est alors bloqué.
function hsl2hex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(x => pad(Math.round(x * 255).toString(16))).join('');
}
function hex2hue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 220;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}
export function openHue({ anchor, value, label, onInput, onPick, onCancel, check }) {
  let hue = /^#[0-9a-f]{6}$/i.test(value || '') ? hex2hue(value) : 220, tone = 1, picked = false;
  const TONES = [[70, 72, 'Claire'], [68, 52, 'Moyenne'], [72, 36, 'Foncée']];
  const cur = () => hsl2hex(hue, TONES[tone][0], TONES[tone][1]);
  const html = '<p class="hue-title">' + esc(label || 'Autre couleur') + '</p>' +
    '<div class="hue-prev" aria-hidden="true"></div>' +
    '<label class="hue-range"><span class="sr">Teinte</span><input type="range" min="0" max="359" step="1" value="' + hue + '" aria-label="Teinte"></label>' +
    '<div class="seg seg3 hue-tones" role="group" aria-label="Nuance">' + TONES.map((t, i) => '<button type="button" data-t="' + i + '" aria-pressed="' + (i === tone) + '">' + t[2] + '</button>').join('') + '</div>' +
    '<p class="hue-warn" role="status"></p>' +
    '<div class="btn-row"><button type="button" class="btn ghost sm" data-c="cancel">Annuler</button><button type="button" class="btn primary sm" data-c="ok">Choisir</button></div>';
  const box = openPop(anchor, html, { label: label || 'Autre couleur', width: 300, cls: 'pop-hue', onClose: () => { if (!picked && onCancel) onCancel(); } });
  const prev = box.querySelector('.hue-prev'), rng = box.querySelector('input[type="range"]');
  const warn = box.querySelector('.hue-warn'), ok = box.querySelector('[data-c="ok"]');
  const upd = () => {
    const h = cur(), msg = check ? check(h) : '';
    prev.style.background = h; warn.textContent = msg; ok.disabled = !!msg;
    if (onInput) onInput(h);
  };
  upd();
  rng.addEventListener('input', () => { hue = +rng.value; upd(); });
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) { tone = +b.dataset.t; box.querySelectorAll('[data-t]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); upd(); }
    else if (b.dataset.c === 'cancel') closePop();
    else if (b.dataset.c === 'ok') { if (b.disabled) return; picked = true; const h = cur(); closePop(true); onPick(h); }
  });
  rng.focus({ preventScroll: true });
}
