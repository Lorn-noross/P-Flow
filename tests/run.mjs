// Test de non-régression des données P-Flow (CLAUDE.md, règle n°1).
// 1. Construit l'appli avec un faux Firebase en mémoire (tests/vite.config.js).
// 2. Charge chaque jeu de données fictif de tests/fixtures (format des anciennes versions).
// 3. Vérifie, sur téléphone et PC, en thème clair et sombre :
//    - les montants affichés (mois et année) ;
//    - modifier / supprimer ne fait rien perdre d'autre, y compris les champs inconnus ;
//    - le garde-fou de lecture seule ; l'écran de premier démarrage.
// Lancement : voir tests/README.md.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { latestNotes } from '../vite.config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'tests/.dist');
const OUT = join(ROOT, 'tests/.out');
mkdirSync(OUT, { recursive: true });

// ---------- construction ----------
if (!process.argv.includes('--no-build')) {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build', '--config', 'tests/vite.config.js'], { cwd: ROOT, stdio: 'inherit' });
}

// ---------- petit serveur local ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_APP = 'http://127.0.0.1:' + server.address().port + '/';

// ---------- outils ----------
const browser = await chromium.launch(process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH, args: (process.env.CHROME_ARGS || '--no-sandbox').split(' ') }
  : {});
const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const clean = s => String(s).replace(/[\s  ]/g, '').replace(/−/g, '-');
const eur = n => clean(EUR.format(n));
let failures = 0, checks = 0;
function check(ok, label) {
  checks++;
  if (ok) return;
  failures++;
  console.log('   ✗ ' + (typeof current === 'string' && current ? '[' + current + '] ' : '') + label);
}
async function until(page, fn, arg, label) {
  try { await page.waitForFunction(fn, arg, { timeout: 5000 }); check(true, label); }
  catch (e) { check(false, label + ' (délai dépassé)'); }
}
const dump = page => page.evaluate(() => window.__PFLOW_DB__.dump());
const NOTES_VERSION = latestNotes().version;
// Réglages en sections (patch 2) : ouvre une sous-page (compte, pro, apparence, donnees, partage, admin, apropos).
async function reglages(page, sub) {
  await page.locator('[data-act="view"][data-view="reglages"]:visible').click();
  if (await page.locator('[data-act="sub-back"]').count()) await page.click('[data-act="sub-back"]');
  if (sub) {
    await page.click('[data-act="sub"][data-sub="' + sub + '"]');
    await until(page, s => !document.getElementById('sub-' + s).hidden, sub, 'Réglages → ' + sub);
  }
}
const noErr = (errors, what) => check(errors.length === 0, 'aucune erreur dans la console' + (what ? ' (' + what + ')' : '') + (errors.length ? ' : ' + errors.join(' | ') : ''));

const CONFIGS = [
  { name: 'téléphone clair', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' },
  { name: 'téléphone sombre', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' },
  { name: 'tablette clair', viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true, colorScheme: 'light' },
  { name: 'PC clair', viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  { name: 'PC sombre', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
];

// ---------- faux Internet ----------
// version.json publiée, bibliothèque Google Identity, et un petit Google Drive en mémoire (opts.drive).
const GIS_STUB = 'window.google={accounts:{oauth2:{initTokenClient:function(c){return{requestAccessToken:function(){c.callback({access_token:"jeton-web",expires_in:3600})}}},hasGrantedAllScopes:function(){return true}}}};';
let driveSeq = 0;
async function fakeInternet(route, opts) {
  const req = route.request(), u = new URL(req.url());
  const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname.endsWith('/version.json')) return json(opts.version || { version: '0.1.0-beta', build: 0, apk: 'https://github.com/Lorn-noross/P-Flow/releases/download/v0.1.0-beta/P-Flow-0.1.0-beta.apk' });
  if (u.host === 'accounts.google.com') return route.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB });
  if (u.host === 'www.googleapis.com') {
    const D = opts.drive || (opts.drive = { files: [], calls: [] });
    D.calls.push(req.method() + ' ' + u.pathname);
    if (!/^Bearer .+/.test(req.headers()['authorization'] || '')) return json({ error: { message: 'no token' } }, 401);
    const qy = u.searchParams.get('q') || '';
    const live = D.files.filter(f => !f.trashed);
    if (req.method() === 'GET' && u.pathname === '/drive/v3/files') {
      let r;
      if (qy.includes("mimeType = 'application/vnd.google-apps.folder'")) r = live.filter(f => f.folder && qy.includes("'" + f.name + "'"));
      else { const m = qy.match(/'([^']+)' in parents/); r = live.filter(f => !f.folder && m && f.parent === m[1]).sort((a, b) => b.createdTime.localeCompare(a.createdTime)); }
      return json({ files: r.map(f => ({ id: f.id, name: f.name, createdTime: f.createdTime, size: String((f.content || '').length) })) });
    }
    if (req.method() === 'POST' && u.pathname === '/drive/v3/files') {
      const meta = JSON.parse(req.postData()); const f = { id: 'f' + (++driveSeq), name: meta.name, folder: true, createdTime: new Date().toISOString() };
      D.files.push(f); return json({ id: f.id });
    }
    if (req.method() === 'POST' && u.pathname === '/upload/drive/v3/files') {
      const body = req.postData(), b = (req.headers()['content-type'].match(/boundary=(\S+)/) || [])[1];
      const parts = body.split('--' + b).slice(1, 3).map(p => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
      const meta = JSON.parse(parts[0]);
      const f = { id: 'f' + (++driveSeq), name: meta.name, parent: meta.parents[0], content: parts[1], createdTime: new Date(Date.now() + driveSeq * 1000).toISOString() };
      D.files.push(f); return json({ id: f.id, name: f.name, createdTime: f.createdTime, size: String(f.content.length) });
    }
    const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m) {
      const f = D.files.find(x => x.id === decodeURIComponent(m[1]));
      if (!f) return json({ error: { message: 'not found' } }, 404);
      if (req.method() === 'PATCH') { Object.assign(f, JSON.parse(req.postData())); return json({ id: f.id }); }
      if (u.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: 'application/json', body: f.content });
    }
    return json({ error: { message: 'non simulé' } }, 400);
  }
  return route.fulfill({ status: 200, body: '' });
}

async function open(cfg, docs, opts = {}) {
  const ctx = await browser.newContext({ viewport: cfg.viewport, isMobile: !!cfg.isMobile, hasTouch: !!cfg.hasTouch, colorScheme: cfg.colorScheme, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  // Aucun accès à Internet pendant les tests : version publiée, bibliothèque Google et Drive sont simulés.
  await page.route(u => !u.href.startsWith(URL_APP), route => fakeInternet(route, opts));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(opts.date + 'T12:00:00+01:00'));
  // Accès : le compte fictif est dans la liste d'emails autorisés (sauf opts.denied), administrateur si opts.admin.
  const seed = Object.assign({}, docs);
  if (!opts.denied) seed['allowlist/test@example.invalid'] = { addedAt: 1767225600000 };
  if (opts.admin) seed['admins/uid-test'] = { ok: true };
  const ls = Object.assign(opts.news ? {} : { 'pf-nouveautes': NOTES_VERSION }, opts.ls || {});
  await page.addInitScript(([s, noUser, tok, ls]) => {
    window.__PFLOW_SEED__ = s; window.__PFLOW_NO_USER__ = noUser; if (tok) window.__PFLOW_DRIVE_TOKEN__ = tok;
    if (!sessionStorage.getItem('pf-test-init')) { sessionStorage.setItem('pf-test-init', '1'); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }
  }, [seed, !!opts.noUser, opts.driveToken || null, ls]);
  await page.goto(URL_APP);
  return { ctx, page, errors };
}
async function waitApp(page) {
  // L'appli s'ouvre sur la dernière vue utilisée (#mois, #reglages…) : montant du mois chargé, ou données synchronisées.
  await until(page, () => { const a = document.getElementById('app'); const h = document.getElementById('hero-amount'); return a && !a.hidden && ((h && h.textContent !== '…') || (location.hash.length > 1 && location.hash !== '#mois' && document.querySelector('.top .sync').dataset.s === 'ok')); }, null, 'l\'appli s\'affiche');
}
const txt = (page, sel) => page.locator(sel).first().innerText().then(clean);
// Cascade du mois (Brut → URSSAF → Net → Dépenses → Épargne → Reste) : libellé sans le signe −, = ou +.
const legend = page => page.$$eval('#legend > div', ds => ds.map(d => [d.querySelector('dt').innerText.replace(/^[\s−=+]+/, '').trim(), d.querySelector('dd').innerText]));

// ---------- scénarios ----------
async function scenarioDonnees(cfg, fx, tag) {
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: fx.expect._date });
  const E = fx.expect;
  await waitApp(page);

  // Mois : montants
  check(await txt(page, '#hero-amount') === eur(E.mars.reste), 'reste du mois = ' + eur(E.mars.reste));
  const L = Object.fromEntries((await legend(page)).map(([k, v]) => [k.replace(/\s*\(.*\)/, ''), clean(v)]));
  check(L['Revenus bruts'] === eur(E.mars.brut), 'revenus bruts');
  check(L['URSSAF'] === eur(E.mars.urssaf), 'URSSAF');
  check(L['Revenus nets'] === eur(E.mars.net), 'revenus nets');
  check(L['Dépenses'] === eur(E.mars.dep), 'dépenses');
  if (E.mars.ep != null) check(L['Épargne'] === eur(E.mars.ep), 'épargne du mois = ' + eur(E.mars.ep));
  else check(!('Épargne' in L), 'pas de ligne Épargne sans épargne');
  for (const l of ['Facture client A', 'Remboursement', 'Aide', 'Courses']) check(await page.locator('#lists .row', { hasText: l }).count() === 1, 'ligne « ' + l + ' » affichée');
  const nf = E.chargesFixes || 1;
  check(await page.locator('#lists', { hasText: 'Charges fixes · ' + nf }).count() === 1, nf + ' charge(s) fixe(s) ce mois-ci (l\'abonnement terminé est exclu)');
  await page.screenshot({ path: join(OUT, tag + '-mois.png'), fullPage: true });

  // Année : totaux
  await page.locator('[data-act="view"][data-view="annee"]:visible').click();
  await until(page, () => !document.getElementById('v-annee').hidden && !document.getElementById('kpis').innerText.includes('…'), null, 'vue Année affichée');
  const K = clean(await page.locator('#kpis').innerText());
  for (const k of ['brut', 'urssaf', 'net', 'dep', 'ep']) if (E.annee2026[k] != null) check(K.includes(eur(E.annee2026[k])), 'total année ' + k + ' = ' + eur(E.annee2026[k]));
  check(K.includes(eur(Math.abs(E.annee2026.reste))) && K.includes(E.annee2026.reste < 0 ? 'manque' : 'Reste'), 'reste de l\'année = ' + eur(E.annee2026.reste));
  await page.screenshot({ path: join(OUT, tag + '-annee.png'), fullPage: true });
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  await until(page, () => !document.getElementById('v-mois').hidden, null, 'retour au mois');

  // Modifier une opération qui porte un champ inconnu
  await page.locator('#lists .row', { hasText: 'Courses' }).click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre de modification ouverte');
  await page.fill('#f-amount', '90');
  await page.click('#f-save');
  await until(page, () => window.__PFLOW_DB__.dump()['users/uid-test/entries/e2'].amount === 90, null, 'montant modifié enregistré');
  let db = await dump(page);
  check(db['users/uid-test/entries/e2'].champFutur === 'à conserver', 'champ inconnu conservé après modification d\'une opération');
  check(db['users/uid-test/entries/e2'].label === 'Courses' && db['users/uid-test/entries/e2'].createdAt === fx.docs['users/uid-test/entries/e2'].createdAt, 'libellé et date de création intacts');

  // Modifier un fixe en cours de route : l'ancien s'arrête, le nouveau garde les champs inconnus
  await page.locator('#lists .row', { hasText: 'Aide' }).click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre du fixe ouverte');
  check(await page.locator('#f-hint:visible').count() === 1, 'avertissement « nouveau montant à partir de… » affiché');
  await page.fill('#f-amount', '120');
  await page.click('#f-save');
  await until(page, () => window.__PFLOW_DB__.dump()['users/uid-test/recurring/r3'].end === '2026-02', null, 'ancien montant du fixe arrêté en février');
  db = await dump(page);
  const nouveaux = Object.entries(db).filter(([k, v]) => k.startsWith('users/uid-test/recurring/') && !fx.docs[k]);
  check(nouveaux.length === 1, 'un seul nouveau fixe créé');
  if (nouveaux.length === 1) {
    const n = nouveaux[0][1];
    check(n.start === '2026-03' && n.amount === 120 && n.label === 'Aide' && n.end === null, 'nouveau fixe correct (mars, 120 €)');
    check(n.champFutur === 'fixe à conserver', 'champ inconnu reporté sur le nouveau fixe');
  }
  check(db['users/uid-test/recurring/r3'].amount === 100 && db['users/uid-test/recurring/r3'].champFutur === 'fixe à conserver', 'ancien fixe intact (100 €, champ inconnu)');

  // Supprimer une opération : seule celle-ci disparaît
  await page.locator('#lists .row', { hasText: 'Remboursement' }).click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre de suppression ouverte');
  await page.click('#f-delete');
  await page.click('#f-delete');
  await until(page, () => !('users/uid-test/entries/e3' in window.__PFLOW_DB__.dump()), null, 'opération supprimée');

  // Rien d'autre n'a été perdu : chaque document et chaque champ d'origine existent encore
  db = await dump(page);
  const removed = new Set(['users/uid-test/entries/e3']);
  for (const [path, d] of Object.entries(fx.docs)) {
    if (removed.has(path)) continue;
    check(path in db, 'document toujours présent : ' + path);
    if (path in db) for (const f of Object.keys(d)) check(f in db[path], 'champ « ' + f + ' » toujours présent dans ' + path);
  }
  // Affichage après modifications : 1 000 + 120 bruts, 212 URSSAF, 90 + 500 de dépenses
  await until(page, v => document.getElementById('hero-amount').textContent.replace(/[\s  ]/g, '') === v, eur(E.apresModif != null ? E.apresModif : 318), 'reste recalculé après modifications');

  noErr(errors);
  await ctx.close();
}

async function scenarioLectureSeule(cfg, fx, tag) {
  const docs = JSON.parse(JSON.stringify(fx.docs));
  docs['users/uid-test/meta/settings'].dataVersion = 99;
  const { ctx, page, errors } = await open(cfg, docs, { date: fx.expect._date });
  await waitApp(page);
  check(await page.locator('#outdated:visible').count() === 1, 'bandeau « version plus récente » affiché');
  await page.locator('[data-act="add"]:visible').click();
  await page.waitForTimeout(300);
  check(await page.locator('#sheet-bg').isHidden(), 'ajout bloqué en lecture seule');
  await page.locator('#lists .row', { hasText: 'Courses' }).click();
  await page.waitForTimeout(300);
  check(await page.locator('#sheet-bg').isHidden(), 'modification bloquée en lecture seule');
  check(await page.evaluate(() => window.__PFLOW_DB__.writes()) === 0, 'aucune écriture en lecture seule');
  check(clean(await page.locator('#hero-amount').innerText()) === eur(fx.expect.mars.reste), 'les données restent consultables');
  await page.screenshot({ path: join(OUT, tag + '-lecture-seule.png') });
  check(errors.length === 0, 'aucune erreur dans la console' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await ctx.close();
}

// Saisie : suggestions de libellés et fenêtre d'ajout au-dessus du clavier (rien n'est enregistré).
async function scenarioSaisie(cfg, fx, tag) {
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(page);
  const H = cfg.viewport.height, W = cfg.viewport.width;
  const items = () => page.$$eval('#f-suggest li', ls => ls.map(l => l.textContent));
  const box = sel => page.locator(sel).first().boundingBox();
  const shown = () => page.locator('#f-suggest').isVisible();

  await page.locator('[data-act="add"]:visible').click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre d\'ajout ouverte');
  check(await page.locator('datalist').count() === 0, 'plus de liste de suggestions native (elle s\'affichait sur le clavier)');

  // Suggestions : au focus, celles du type choisi seulement
  await page.click('#f-label');
  await until(page, () => !document.getElementById('f-suggest').hidden, null, 'suggestions affichées au toucher du champ');
  let it = await items();
  check(it.includes('Courses') && it.includes('Loyer') && !it.includes('Facture client A'), 'dépense : seulement des libellés de dépenses (' + it.join(', ') + ')');
  const lb = await box('#f-label'), sb = await box('#f-suggest');
  check(sb && lb && sb.y >= lb.y + lb.height - 1, 'suggestions placées sous le champ, dans la fenêtre');

  // Filtrage en tapant, sans tenir compte des majuscules ni des accents
  await page.fill('#f-label', 'LO');
  it = await items();
  check(it.length === 1 && it[0] === 'Loyer', 'filtrage « LO » → Loyer (' + it.join(', ') + ')');
  await page.locator('#f-suggest li', { hasText: 'Loyer' }).click();
  check(await page.inputValue('#f-label') === 'Loyer', 'toucher une suggestion remplit le champ');
  check(!(await shown()), 'la liste se ferme après le choix');

  // Changer de type : suggestions des revenus
  await page.click('#type-seg [data-type="revenu"]');
  await page.fill('#f-label', '');
  await page.click('#f-label');
  await page.fill('#f-label', 'fac');
  it = await items();
  check(it.length === 1 && it[0] === 'Facture client A', 'revenu : « fac » → Facture client A (' + it.join(', ') + ')');

  // Clavier physique (PC) : flèches + Entrée choisissent sans enregistrer ; Échap ferme la liste, pas la fenêtre
  await page.click('#type-seg [data-type="depense"]');
  await page.click('#f-label');
  await page.fill('#f-label', 'e');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check(await page.inputValue('#f-label') === 'Essence', 'flèche bas + Entrée choisit la 1re suggestion');
  check(await page.locator('#sheet-bg').isVisible(), 'Entrée sur une suggestion n\'enregistre pas');
  await page.fill('#f-label', 'c');
  check(await shown(), 'suggestions pour « c »');
  await page.keyboard.press('Escape');
  check(!(await shown()) && await page.locator('#sheet-bg').isVisible(), 'Échap ferme la liste, pas la fenêtre');

  if (cfg.isMobile) {
    // Android 15 et plus : le clavier recouvre l'appli sans la redimensionner
    const KBH = Math.round(H * 0.4);
    await page.fill('#f-label', '');
    await page.click('#f-label');
    await page.evaluate(h => window.__pfSetKeyboard(h), KBH);
    await page.waitForTimeout(250);
    const top = H - KBH;
    const sh = await box('#sheet'), f = await box('#f-label'), li = await box('#f-suggest li');
    check(sh && sh.y + sh.height <= top + 1, 'clavier qui recouvre : la fenêtre reste au-dessus (bas ' + Math.round(sh.y + sh.height) + ' ≤ ' + top + ')');
    check(f && f.y >= 0 && f.y + f.height <= top + 1, 'clavier qui recouvre : le champ tapé reste visible');
    check(li && li.y + li.height <= top + 1, 'clavier qui recouvre : les suggestions restent visibles');
    check(await page.locator('.fab').evaluate(e => getComputedStyle(e).visibility) === 'hidden', 'bouton + masqué quand le clavier est ouvert');
    await page.screenshot({ path: join(OUT, tag + '-clavier-recouvre.png') });
    await page.evaluate(() => window.__pfSetKeyboard(0));
    await page.waitForTimeout(100);
    const sh2 = await box('#sheet');
    if (W < 700) check(sh2 && Math.abs(sh2.y + sh2.height - H) <= 1, 'clavier fermé : la fenêtre redescend en bas');
    else check(sh2 && Math.abs(sh2.y + sh2.height / 2 - H / 2) <= 2, 'clavier fermé : la fenêtre revient au centre (tablette)');

    // Anciens Android / navigateurs : le clavier réduit la fenêtre
    await page.click('#f-label');
    const h2 = Math.round(H * 0.55);
    await page.setViewportSize({ width: W, height: h2 });
    await page.waitForTimeout(300);
    const sh3 = await box('#sheet'), f3 = await box('#f-label');
    check(sh3 && sh3.y + sh3.height <= h2 + 1, 'fenêtre réduite : la fenêtre tient dans la hauteur restante');
    check(f3 && f3.y >= 0 && f3.y + f3.height <= h2 + 1, 'fenêtre réduite : le champ tapé reste visible');
    await page.screenshot({ path: join(OUT, tag + '-clavier-reduit.png') });
    await page.setViewportSize(cfg.viewport);
  }

  await page.click('#sheet-close');
  check(await page.evaluate(() => window.__PFLOW_DB__.writes()) === 0, 'rien n\'a été enregistré pendant la saisie');
  check(errors.length === 0, 'aucune erreur dans la console' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await ctx.close();
}

// Couleurs : appliquées dès le chargement (synchro entre appareils), choix, retour par défaut,
// et aucun autre réglage touché.
async function scenarioCouleurs(cfg, fx, tag) {
  const SET = 'users/uid-test/meta/settings';
  const docs = JSON.parse(JSON.stringify(fx.docs));
  docs[SET].couleurs = { reste: '#7A5AF8', dep: 'pas-une-couleur' };
  const { ctx, page, errors } = await open(cfg, docs, { date: fx.expect._date });
  await waitApp(page);
  const css = (sel, prop) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e)[p], prop);
  const inline = k => page.evaluate(k => document.documentElement.style.getPropertyValue('--c-' + k), k);

  check(await css('#hero-amount', 'color') === 'rgb(122, 90, 248)', 'couleur du reste venue d\'un autre appareil appliquée au chargement');
  check(await inline('dep') === '', 'une couleur invalide est ignorée (couleur par défaut)');

  await reglages(page, 'apparence');
  await until(page, () => document.querySelectorAll('#colors .color-head').length === 5, null, '5 couleurs réglables (profil auto-entrepreneur)');
  await page.click('#colors [data-act="color-open"][data-k="dep"]');
  await page.click('#colors [data-act="color-set"][data-k="dep"][data-c="#c23b35"]');
  await until(page, () => (window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].couleurs || {}).dep === '#c23b35', null, 'couleur des dépenses enregistrée dans le compte');
  await until(page, () => document.documentElement.style.getPropertyValue('--c-dep') === '#c23b35', null, 'couleur des dépenses appliquée tout de suite');
  await until(page, () => !!document.querySelector('#colors [data-c="#c23b35"][aria-pressed="true"]'), null, 'la couleur choisie est marquée');
  let s = (await dump(page))[SET];
  check(s.pro === true && s.taux['2026'] === 21.2 && s.periodicite === 'mensuelle' && s.createdAt === fx.docs[SET].createdAt, 'les autres réglages sont intacts');
  check(s.couleurs.reste === '#7A5AF8', 'les autres couleurs sont intactes');
  await page.screenshot({ path: join(OUT, tag + '-couleurs.png'), fullPage: true });

  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  check(await css('#legend .s-dep', 'backgroundColor') === 'rgb(194, 59, 53)', 'vue Mois : légende des dépenses à la nouvelle couleur');
  await page.locator('[data-act="view"][data-view="annee"]:visible').click();
  await until(page, () => !!document.querySelector('#y-top .bar i:not(.p)'), null, 'vue Année : « Où part l\'argent » affiché');
  check(await css('#y-top .bar i:not(.p)', 'backgroundColor') === 'rgb(194, 59, 53)', 'vue Année : dépenses fixes à la nouvelle couleur');

  await reglages(page, 'apparence');
  await page.click('#colors [data-act="color-reset"][data-k="dep"]');
  await until(page, () => window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].couleurs.dep === null, null, '« Par défaut » enregistré');
  await until(page, () => document.documentElement.style.getPropertyValue('--c-dep') === '', null, 'couleur des dépenses revenue par défaut');
  await page.click('[data-act="colors-reset"]');
  await until(page, () => window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].couleurs.reste === null, null, 'toutes les couleurs remises par défaut');
  await until(page, () => document.documentElement.style.getPropertyValue('--c-reste') === '', null, 'couleur du reste revenue par défaut');
  s = (await dump(page))[SET];
  check(s.pro === true && s.taux['2026'] === 21.2 && s.periodicite === 'mensuelle', 'réglages toujours intacts après remise à zéro');
  check(errors.length === 0, 'aucune erreur dans la console' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await ctx.close();
}

// Accès : liste d'emails autorisés gérée par l'administrateur.
async function scenarioAcces(cfg, fx, tag) {
  let o = await open(cfg, fx.docs, { date: fx.expect._date, denied: true });
  await until(o.page, () => !document.getElementById('s-denied').hidden, null, 'compte hors liste : écran « accès pas encore autorisé »');
  check(await o.page.evaluate(() => window.__PFLOW_DB__.writes()) === 0, 'compte hors liste : rien n\'est écrit');
  check(o.errors.length === 0, 'aucune erreur dans la console (refus)' + (o.errors.length ? ' : ' + o.errors.join(' | ') : ''));
  await o.ctx.close();

  o = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(o.page);
  await reglages(o.page);
  check(await o.page.locator('[data-act="sub"][data-sub="admin"]').isHidden() && await o.page.locator('#admin-card').isHidden(), 'non-administrateur : pas de gestion des accès');
  await o.ctx.close();

  o = await open(cfg, fx.docs, { date: fx.expect._date, admin: true });
  const page = o.page;
  await waitApp(page);
  await reglages(page, 'admin');
  check(await page.locator('#admin-card').isVisible(), 'administrateur : carte de gestion des accès visible');
  await page.fill('#allow-email', 'Parent@Example.invalid');
  await page.locator('#allow-form [type="submit"]').click();
  await until(page, () => 'allowlist/parent@example.invalid' in window.__PFLOW_DB__.dump(), null, 'email ajouté à la liste (en minuscules)');
  await until(page, () => document.getElementById('allow-list').textContent.includes('parent@example.invalid'), null, 'email affiché dans la liste');
  const del = page.locator('#allow-list [data-act="allow-del"][data-email="parent@example.invalid"]');
  await del.click(); await del.click();
  await until(page, () => !('allowlist/parent@example.invalid' in window.__PFLOW_DB__.dump()), null, 'email retiré après confirmation');
  check('allowlist/test@example.invalid' in (await dump(page)), 'son propre email reste dans la liste');
  check(o.errors.length === 0, 'aucune erreur dans la console' + (o.errors.length ? ' : ' + o.errors.join(' | ') : ''));
  await o.ctx.close();
}

// Sauvegardes : export complet, import qui remet seulement ce qui manque, Google Drive (simulé).
async function scenarioSauvegardes(cfg, fx, tag) {
  const E2 = 'users/uid-test/entries/e2', E3 = 'users/uid-test/entries/e3', R2 = 'users/uid-test/recurring/r2';
  const NB = (fx.expect.nb) || { entries: 4, recurring: 3 };

  // 1. Exporter : un fichier avec tout le compte
  let o = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(o.page); await reglages(o.page, 'donnees');
  const [dl] = await Promise.all([o.page.waitForEvent('download'), o.page.click('[data-act="backup-export"]')]);
  // Nom de fichier sans accent : Chromium sans écran refuse les chemins accentués pour l'envoi de fichier.
  const file = join(OUT, tag.normalize('NFD').replace(/[\u0300-\u036f]/g, '') + '-sauvegarde.json');
  await dl.saveAs(file);
  const bk = JSON.parse(readFileSync(file, 'utf8'));
  check(bk.app === 'P-Flow' && bk.format === 2 && bk.dataVersion === 1 && bk.entries.length === NB.entries && bk.recurring.length === NB.recurring, 'export : toutes les opérations et tous les fixes');
  check(bk.periodiques.length === (NB.periodiques || 0) && bk.epargne.length === (NB.epargne || 0), 'export : fixes non mensuels et épargne (' + bk.periodiques.length + ', ' + bk.epargne.length + ')');
  check(bk.entries.find(e => e.id === 'e2').champFutur === 'à conserver' && bk.settings.pro === true, 'export : champs et réglages complets');
  check(/^p-flow-sauvegarde-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}\.json$/.test(dl.suggestedFilename()), 'export : nom de fichier daté');
  await o.ctx.close();

  // 2. Importer dans un compte où il manque des choses, et où une opération a été modifiée depuis
  const docs = JSON.parse(JSON.stringify(fx.docs));
  delete docs[E3]; delete docs[R2]; docs[E2].amount = 99;
  o = await open(cfg, docs, { date: fx.expect._date });
  await waitApp(o.page); await reglages(o.page, 'donnees');
  await o.page.setInputFiles('#import-file', file);
  await until(o.page, () => !document.getElementById('restore-panel').hidden, null, 'import : résumé avant de restaurer');
  const txt = await o.page.locator('#restore-panel').innerText();
  check(txt.includes('1 opération et 1 fixe'), 'import : annonce exactement ce qui manque (' + txt.replace(/\s+/g, ' ').slice(0, 90) + '…)');
  const writes0 = await o.page.evaluate(() => window.__PFLOW_DB__.writes());
  check(writes0 === 0, 'import : rien n\'est écrit avant confirmation');
  await o.page.click('[data-act="restore-go"]');
  await until(o.page, ([a, b]) => { const d = window.__PFLOW_DB__.dump(); return a in d && b in d; }, [E3, R2], 'import : opération et fixe manquants remis');
  const db = await dump(o.page);
  check(JSON.stringify(db[E3]) === JSON.stringify(fx.docs[E3]) && JSON.stringify(db[R2]) === JSON.stringify(fx.docs[R2]), 'import : remis à l\'identique');
  check(db[E2].amount === 99, 'import : une opération modifiée depuis n\'est pas écrasée');
  check(Object.keys(db).filter(k => k.startsWith('users/')).length === Object.keys(fx.docs).length, 'import : aucun doublon, rien de supprimé');
  // Hors ligne : ni sauvegarde partielle, ni restauration calculée sur le cache de l'appareil
  await o.page.evaluate(() => { window.__PFLOW_OFFLINE__ = true; });
  const w1 = await o.page.evaluate(() => window.__PFLOW_DB__.writes());
  await o.page.setInputFiles('#import-file', file);
  await until(o.page, () => document.getElementById('backup-status').textContent.includes('connecté à internet'), null, 'hors ligne : import refusé avec un message clair');
  check(await o.page.locator('#restore-panel').isHidden() && await o.page.evaluate(() => window.__PFLOW_DB__.writes()) === w1, 'hors ligne : rien n\'est restauré');
  await o.page.click('[data-act="backup-export"]');
  await until(o.page, () => document.getElementById('backup-status').textContent.includes('connecté à internet'), null, 'hors ligne : export refusé (pas de sauvegarde incomplète)');
  await o.page.evaluate(() => { window.__PFLOW_OFFLINE__ = false; });
  // Fichier qui n'est pas une sauvegarde
  await o.page.setInputFiles('#import-file', { name: 'photo.json', mimeType: 'application/json', buffer: Buffer.from('{"bonjour":1}') });
  await until(o.page, () => document.getElementById('backup-status').textContent.includes('pas une sauvegarde'), null, 'import : fichier étranger refusé');
  check(o.errors.length === 0, 'aucune erreur dans la console (fichier)' + (o.errors.length ? ' : ' + o.errors.join(' | ') : ''));
  await o.ctx.close();

  // 3. Google Drive : connexion, première copie, 12 copies gardées, restauration
  const drive = { files: [], calls: [] };
  o = await open(cfg, fx.docs, { date: fx.expect._date, driveToken: 'jeton-test', drive });
  const page = o.page;
  await waitApp(page); await reglages(page, 'donnees');
  await page.click('[data-act="drive-connect"]');
  await until(page, () => { const s = window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].sauvegarde; return s && s.drive === true && s.derniere > 0; }, null, 'Drive : connecté, date de la copie enregistrée dans le compte');
  const folders = drive.files.filter(f => f.folder), copies = () => drive.files.filter(f => !f.folder && !f.trashed);
  check(folders.length === 1 && folders[0].name === 'P-Flow Sauvegardes', 'Drive : dossier « P-Flow Sauvegardes » créé');
  check(copies().length === 1 && JSON.parse(copies()[0].content).entries.length === NB.entries, 'Drive : première copie complète');
  for (let i = 2; i <= 13; i++) {
    await until(page, () => !document.querySelector('[data-act="drive-now"]').disabled, null, 'Drive : prêt pour la copie ' + i);
    await page.click('[data-act="drive-now"]');
    await until(page, n => document.getElementById('backup-status').textContent.includes('Sauvegarde faite') && !document.querySelector('[data-act="drive-now"]').disabled, i, 'Drive : copie ' + i + ' faite');
  }
  check(copies().length === 12 && drive.files.filter(f => f.trashed).length === 1, 'Drive : 12 copies gardées, la plus ancienne à la corbeille (' + copies().length + ')');
  check(drive.files.filter(f => f.folder).length === 1, 'Drive : toujours un seul dossier');
  await page.click('[data-act="drive-list"]');
  await until(page, () => document.querySelectorAll('#drive-list [data-act="drive-pick"]').length === 12, null, 'Drive : les 12 copies sont proposées');
  await page.locator('#drive-list [data-act="drive-pick"]').first().click();
  await until(page, () => document.getElementById('restore-panel').innerText.includes('déjà tout'), null, 'Drive : restauration d\'une copie complète → rien à remettre');
  await page.click('[data-act="restore-cancel"]');
  await page.screenshot({ path: join(OUT, tag + '-sauvegarde.png'), fullPage: true });
  check(o.errors.length === 0, 'aucune erreur dans la console (Drive)' + (o.errors.length ? ' : ' + o.errors.join(' | ') : ''));
  await o.ctx.close();

  // 4. Copie automatique due : bandeau (navigateur), puis copie en un toucher
  const due = JSON.parse(JSON.stringify(fx.docs));
  due['users/uid-test/meta/settings'].sauvegarde = { drive: true, frequence: 'mensuelle', derniere: Date.parse('2026-01-01') };
  const drive2 = { files: [], calls: [] };
  o = await open(cfg, due, { date: fx.expect._date, driveToken: 'consent', drive: drive2 });
  await waitApp(o.page);
  await until(o.page, () => !document.getElementById('backup-due').hidden, null, 'copie due : bandeau affiché');
  await o.page.click('[data-act="drive-due"]');
  await until(o.page, () => document.getElementById('backup-due').hidden, null, 'copie due : bandeau retiré après la copie');
  check(drive2.files.filter(f => !f.folder).length === 1, 'copie due : une copie envoyée');
  await o.ctx.close();
  const recent = JSON.parse(JSON.stringify(due));
  recent['users/uid-test/meta/settings'].sauvegarde.derniere = Date.parse('2026-03-10');
  o = await open(cfg, recent, { date: fx.expect._date, driveToken: 'consent' });
  await waitApp(o.page); await o.page.waitForTimeout(300);
  check(await o.page.locator('#backup-due').isHidden(), 'copie récente : pas de bandeau');
  await o.ctx.close();
}

// Mises à jour (navigateur) : vérification automatique, bandeau « Recharger », vérification manuelle.
async function scenarioMisesAJour(cfg, fx, tag) {
  const v = { version: '0.1.1-beta', build: 999, apk: 'https://github.com/Lorn-noross/P-Flow/releases/download/v0.1.1-beta/P-Flow-0.1.1-beta.apk' };
  let o = await open(cfg, fx.docs, { date: fx.expect._date, version: v });
  await waitApp(o.page);
  await until(o.page, () => document.getElementById('update').innerText.includes('0.1.1 bêta'), null, 'mise à jour : bandeau « 0.1.1 bêta disponible »');
  check(await o.page.locator('#update [data-act="upd-reload"]').count() === 1, 'mise à jour : bouton Recharger (navigateur)');
  await reglages(o.page, 'apropos');
  check((await o.page.locator('#upd-status').innerText()).includes('0.1.1 bêta'), 'Réglages : nouvelle version annoncée');
  await o.page.click('#upd-auto [data-v="semaine"]');
  check(await o.page.locator('#upd-auto [data-v="semaine"][aria-checked="true"]').count() === 1 && await o.page.locator('#upd-auto [aria-checked="true"]').count() === 1, 'Réglages : un seul intervalle coché');
  check(await o.page.evaluate(() => localStorage.getItem('pf-maj-auto')) === 'semaine', 'Réglages : intervalle de vérification enregistré');
  await o.ctx.close();
  o = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(o.page);
  await reglages(o.page, 'apropos');
  await o.page.click('#upd-check');
  await until(o.page, () => document.getElementById('upd-status').textContent.includes('dernière version'), null, 'vérification manuelle : « Tu as la dernière version »');
  check(await o.page.locator('#update').isHidden(), 'pas de bandeau sans nouvelle version');
  check(o.errors.length === 0, 'aucune erreur dans la console' + (o.errors.length ? ' : ' + o.errors.join(' | ') : ''));
  await o.ctx.close();
}

async function scenarioNouveauCompte(cfg, tag) {
  const { ctx, page, errors } = await open(cfg, {}, { date: '2026-03-15', news: true });
  await until(page, () => !document.getElementById('s-onboard').hidden, null, 'configuration guidée pour un nouveau compte');
  await page.screenshot({ path: join(OUT, tag + '-bienvenue.png') });
  // 1. Profil
  await page.click('#o-profile [data-pro="1"]');
  await page.click('#ob-next');
  check((await page.locator('#o-error').innerText()).includes('taux'), 'auto-entrepreneur : taux demandé');
  await page.fill('#o-rate', '21,2');
  await page.click('#ob-next');
  // 2. Revenus fixes : passer
  await until(page, () => document.getElementById('ob-count').textContent.includes('2 sur 6'), null, 'étape 2 sur 6');
  await page.click('#ob-skip');
  // 3. Charges fixes : boutons rapides (libellé modifiable) et charge au libellé libre
  await page.click('[data-ob="add"][data-l="Loyer"]');
  await page.fill('.ob-row[data-i="0"] [data-f="amount"]', '650');
  await page.click('[data-ob="add"][data-l="Assurance"]');
  await page.fill('.ob-row[data-i="1"] [data-f="amount"]', '300');
  await page.selectOption('.ob-row[data-i="1"] [data-f="freq"]', 'annee');
  await page.click('[data-ob="add"][data-k="dep"][data-l=""]');
  await page.fill('.ob-row[data-i="2"] [data-f="label"]', 'Cantine des enfants');
  await page.click('#ob-next');
  check((await page.locator('#o-error').innerText()).includes('Cantine'), 'montant manquant signalé');
  await page.fill('.ob-row[data-i="2"] [data-f="amount"]', '45,50');
  await page.click('#ob-next');
  // 4. Épargne : Livret A, solde 1 200 €, 50 € chaque mois
  await page.click('[data-ob="ep"][data-v="1"]');
  await page.click('[data-ob="add"][data-k="ep"][data-l="Livret A"]');
  await page.fill('.ob-row[data-i="0"] [data-f="amount"]', '1 200');
  await page.fill('.ob-row[data-i="0"] [data-f="auto"]', '50');
  await page.click('#ob-next');
  // 5. Apparence
  await page.click('[data-ob="theme"][data-t="sombre"]');
  check(await page.evaluate(() => document.documentElement.getAttribute('data-scheme')) === 'dark', 'apparence appliquée tout de suite');
  await page.click('#ob-next');
  // 6. Sauvegarde : plus tard
  await until(page, () => document.getElementById('ob-next').textContent.includes('parti'), null, 'dernière étape');
  check(await page.evaluate(() => window.__PFLOW_DB__.writes()) === 0, 'rien n\'est écrit avant la fin');
  await page.click('#ob-next');
  await until(page, () => !document.getElementById('app').hidden && document.getElementById('hero-amount').textContent !== '…', null, 'l\'appli s\'ouvre');
  const db = await dump(page), U = 'users/uid-test/';
  const st = db[U + 'meta/settings'];
  check(st && st.pro === true && st.taux['2026'] === 21.2 && st.periodicite === 'mensuelle' && st.epargne === true && typeof st.createdAt === 'number', 'réglages du compte');
  const of = (col, f) => Object.entries(db).filter(([k, v]) => k.startsWith(U + col + '/') && f(v)).length;
  check(of('recurring', v => v.label === 'Loyer' && v.amount === 650 && v.type === 'depense' && v.start === '2026-03' && v.end === null && v.urssaf === false) === 1, 'Loyer : fixe mensuel (même document qu\'un ajout manuel)');
  check(of('periodiques', v => v.label === 'Assurance' && v.amount === 300 && v.freq === 'annee' && v.start === '2026-03' && v.type === 'depense') === 1, 'Assurance : fixe annuel');
  check(of('recurring', v => v.label === 'Cantine des enfants' && v.amount === 45.5) === 1, 'charge au libellé libre');
  check(of('epargne', v => v.op === 'solde' && v.label === 'Livret A' && v.amount === 1200 && v.date === '2026-03-15') === 1, 'solde du Livret A');
  check(of('periodiques', v => v.type === 'epargne' && v.label === 'Livret A' && v.amount === 50 && v.freq === 'mois' && v.start === '2026-04') === 1, 'versement automatique à partir du mois prochain');
  check(Object.keys(db).filter(k => k.startsWith(U)).length === 6, 'rien d\'autre n\'est écrit');
  await page.waitForTimeout(1200);
  check(await page.locator('#panel-bg').isHidden(), 'pas de « nouveautés » pour un nouveau compte');
  // Mars : aucun revenu, 650 + 300 + 45,50 de charges (le versement automatique commence en avril)
  await waitHero(page, -995.5, 'reste du mois du nouveau compte');
  await page.screenshot({ path: join(OUT, tag + '-apres-config.png') });
  noErr(errors);
  await ctx.close();
}

// ---------- patch 2 ----------
const hero = page => page.locator('#hero-amount').innerText().then(clean);
const waitHero = (page, v, label) => until(page, x => document.getElementById('hero-amount').textContent.replace(/[\s  ]/g, '').replace(/−/g, '-') === x, eur(v), label);

// Épargne et fixes trimestriels / annuels (jeux de données au nouveau format).
async function scenarioEpargne(cfg, fx, tag) {
  const E = fx.expect, EP = 'users/uid-test/epargne/', PER = 'users/uid-test/periodiques/';
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: E._date });
  await waitApp(page);
  const card = clean(await page.locator('#ep-card').innerText());
  check(card.includes(eur(E.epargne.total)), 'épargne : total des comptes = ' + eur(E.epargne.total));
  for (const [k, v] of Object.entries(E.epargne)) if (k !== 'total') check(clean(await page.locator('#ep-card .row', { hasText: k }).innerText()).includes(eur(v)), 'épargne : solde ' + k + ' = ' + eur(v));
  check(await page.locator('#lists', { hasText: 'Épargne du mois' }).count() === 1, 'épargne du mois listée');
  // Solde à la fin du mois affiché : février = Livret A 1 000 + 50 (versement) et PEL 5 000 ; janvier = Livret A seul
  await page.click('[data-act="prev-month"]');
  await until(page, v => document.getElementById('ep-card').innerText.replace(/[\s\u00a0\u202f]/g, '').includes(v), eur(6050), 'épargne fin février = ' + eur(6050));
  await page.click('[data-act="prev-month"]');
  await until(page, v => document.getElementById('ep-card').innerText.replace(/[\s\u00a0\u202f]/g, '').includes(v) && !document.getElementById('ep-card').innerText.includes('PEL'), eur(1000), 'épargne fin janvier = ' + eur(1000) + ' (PEL pas encore noté)');
  await page.click('[data-act="today"]');
  await until(page, () => document.querySelector('#ctx h1').textContent === 'Mars 2026', null, 'retour en mars');
  check(await page.locator('#lists .row', { hasText: 'Prime' }).count() === 1, 'fixe trimestriel compté le mois où il tombe (Prime)');
  check(await page.locator('#lists .row', { hasText: 'Assurance auto' }).count() === 0, 'fixe trimestriel absent hors échéance (Assurance auto)');

  // Fixes : moyenne par mois et prochaine échéance
  await page.locator('[data-act="view"][data-view="fixes"]:visible').click();
  await until(page, () => !document.getElementById('v-fixes').hidden, null, 'vue Fixes');
  const ft = clean(await page.locator('#fix-totals').innerText());
  const F = E.fixesParMois;
  check(ft.includes(eur(F.reste)) && ft.includes(eur(F.charges)) && ft.includes(eur(F.revenus)) && ft.includes(eur(F.epargne)), 'Fixes : « après les fixes » et moyennes par mois (' + ft.slice(0, 80) + ')');
  check(await page.locator('#fix-list .row', { hasText: 'Assurance auto' }).filter({ hasText: 'prochaine : avril 2026' }).count() === 1, 'Fixes : prochaine échéance du trimestriel (avril 2026)');
  check(await page.locator('#fix-list .row', { hasText: 'Assurance habitation' }).filter({ hasText: 'ce mois-ci' }).count() === 1, 'Fixes : échéance de l\'annuel ce mois-ci');

  // Nouveau fixe trimestriel depuis Fixes (bouton +)
  await page.locator('[data-act="add"]:visible').click();
  await until(page, () => !document.getElementById('sheet-bg').hidden && !document.getElementById('f-start-field').hidden, null, 'Fixes : + ouvre « Nouveau fixe »');
  await page.click('#freq-seg [data-f="trimestre"]');
  await page.fill('#f-amount', '90'); await page.fill('#f-label', 'Taxe trimestrielle');
  await page.click('#f-save');
  await until(page, p => Object.entries(window.__PFLOW_DB__.dump()).some(([k, v]) => k.startsWith(p) && v.label === 'Taxe trimestrielle' && v.freq === 'trimestre' && v.start === '2026-03' && v.type === 'depense' && v.end === null), PER, 'fixe trimestriel enregistré dans « periodiques »');
  let db = await dump(page);
  check(!Object.values(db).some(v => v.label === 'Taxe trimestrielle' && 'month' in v), 'le fixe trimestriel n\'est pas dans « recurring » ni « entries »');

  // Retour au mois : la taxe compte en mars
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  await waitHero(page, E.mars.reste - 90, 'reste de mars avec le nouveau trimestriel');

  // Modifier le fixe trimestriel en cours de route : l'ancien s'arrête, le nouveau garde le cycle et les champs inconnus
  await page.locator('#lists .row', { hasText: 'Prime' }).click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre du fixe trimestriel');
  check(await page.locator('#f-hint:visible').count() === 1, 'avertissement « nouveau montant à partir de… » (trimestriel)');
  await page.fill('#f-amount', '350'); await page.click('#f-save');
  await until(page, k => (window.__PFLOW_DB__.dump()[k] || {}).end === '2026-02', PER + 'p4', 'ancien trimestriel arrêté en février');
  db = await dump(page);
  const nP = Object.entries(db).filter(([k, v]) => k.startsWith(PER) && v.label === 'Prime' && k !== PER + 'p4');
  check(nP.length === 1 && nP[0][1].amount === 350 && nP[0][1].start === '2026-03' && nP[0][1].freq === 'trimestre' && nP[0][1].champFutur === 'périodique à conserver', 'nouveau trimestriel correct (mars, 350 €, champ inconnu reporté)');
  check(db[PER + 'p4'].amount === 300 && db[PER + 'p4'].champFutur === 'périodique à conserver', 'ancien trimestriel intact (300 €, champ inconnu)');

  // Passer un fixe mensuel en trimestriel en cours de route : l'ancien s'arrête (jamais supprimé), le nouveau garde le cycle
  await page.locator('[data-act="view"][data-view="fixes"]:visible').click();
  await page.locator('#fix-list .row', { hasText: 'Loyer' }).click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre du loyer');
  await page.click('#freq-seg [data-f="trimestre"]');
  const w0 = await page.evaluate(() => window.__PFLOW_DB__.writes());
  await page.click('#f-save');
  await until(page, k => (window.__PFLOW_DB__.dump()[k] || {}).end === '2026-02', 'users/uid-test/recurring/r1', 'loyer mensuel arrêté en février (pas supprimé)');
  db = await dump(page);
  const nL = Object.entries(db).filter(([k, v]) => k.startsWith(PER) && v.label === 'Loyer');
  check(nL.length === 1 && nL[0][1].freq === 'trimestre' && nL[0][1].start === '2026-03' && nL[0][1].amount === 500 && nL[0][1].end === null, 'loyer trimestriel à partir de mars');
  check(db['users/uid-test/recurring/r1'].start === '2025-09' && db['users/uid-test/recurring/r1'].amount === 500, 'ancien loyer intact pour les mois passés');
  check(await page.evaluate(() => window.__PFLOW_DB__.writes()) - w0 === 2, 'changement de fréquence : deux écritures ensemble, rien d\'autre');
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  await waitHero(page, E.mars.reste - 90 + 50, 'mars inchangé par le passage au trimestriel');

  // Ajouter de l'épargne avec le bouton rond « Épargne »
  await page.click('[data-act="add-type"][data-type="epargne"]');
  await until(page, () => !document.getElementById('sheet-bg').hidden && !document.getElementById('op-seg').hidden, null, 'bouton Épargne : fenêtre en mode épargne');
  await page.fill('#f-amount', '20'); await page.fill('#f-label', 'Livret A'); await page.click('#f-save');
  await until(page, p => Object.entries(window.__PFLOW_DB__.dump()).some(([k, v]) => k.startsWith(p) && v.op === 'depot' && v.amount === 20 && v.month === '2026-03' && v.label === 'Livret A'), EP, 'dépôt d\'épargne enregistré');
  await waitHero(page, E.mars.reste - 90 + 50 - 20, 'le dépôt baisse le reste du mois');

  // Modifier un dépôt garde les champs inconnus
  await page.locator('#lists .row', { hasText: 'Livret A' }).filter({ hasText: '8 mars' }).click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre de modification du dépôt');
  check(await page.locator('#type-seg').isHidden() && await page.locator('#op-seg [data-op="depot"][aria-pressed="true"]').count() === 1, 'modification d\'épargne : type figé, « J\'ai mis de côté » choisi');
  await page.fill('#f-amount', '160'); await page.click('#f-save');
  await until(page, k => (window.__PFLOW_DB__.dump()[k] || {}).amount === 160, EP + 'ep2', 'dépôt modifié');
  db = await dump(page);
  check(db[EP + 'ep2'].champFutur === 'épargne à conserver' && db[EP + 'ep2'].op === 'depot' && db[EP + 'ep2'].createdAt === fx.docs[EP + 'ep2'].createdAt, 'dépôt : champ inconnu et date de création conservés');

  // Un solde (« J'ai actuellement ») ne change pas le reste
  await waitHero(page, E.mars.reste - 90 + 50 - 20 - 10, 'dépôt modifié pris en compte');
  const before = await hero(page);
  await page.click('[data-act="add-type"][data-type="epargne"]');
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre épargne');
  await page.click('#op-seg [data-op="solde"]');
  check(await page.locator('#f-freq-field').isHidden(), 'solde : pas de fréquence');
  await page.fill('#f-amount', '5100'); await page.fill('#f-label', 'PEL'); await page.click('#f-save');
  await until(page, p => Object.entries(window.__PFLOW_DB__.dump()).some(([k, v]) => k.startsWith(p) && v.op === 'solde' && v.amount === 5100), EP, 'solde enregistré');
  await page.waitForTimeout(600);
  check(await hero(page) === before, 'un solde ne change pas le reste du mois');
  await until(page, () => document.getElementById('ep-card').innerText.replace(/[\s  ]/g, '').includes('5100,00€'), null, 'nouveau solde du PEL affiché');

  // Désactiver l'épargne : plus affichée ni comptée, données gardées
  await reglages(page, 'compte');
  await page.click('#ep-toggle');
  await until(page, () => window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].epargne === false, null, 'épargne désactivée dans le compte');
  db = await dump(page);
  check(Object.keys(db).filter(k => k.startsWith(EP)).length === 6, 'épargne désactivée : les opérations d\'épargne restent enregistrées');
  check(db['users/uid-test/meta/settings'].pro === true && db['users/uid-test/meta/settings'].taux['2026'] === 21.2, 'les autres réglages sont intacts');
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  await until(page, () => document.getElementById('ep-card').offsetParent === null, null, 'carte Épargne masquée');
  await page.screenshot({ path: join(OUT, tag + '-epargne-off.png') });

  // Tout ce qui existait est encore là
  db = await dump(page);
  for (const [path, d] of Object.entries(fx.docs)) {
    check(path in db, 'document toujours présent : ' + path);
    if (path in db) for (const f of Object.keys(d)) check(f in db[path], 'champ « ' + f + ' » toujours présent dans ' + path);
  }
  noErr(errors);
  await ctx.close();
}

// Comptes d'avant le patch 2 : proposition légère d'activer l'épargne (enregistrée dans le compte).
async function scenarioOffreEpargne(cfg, fx, tag) {
  const SET = 'users/uid-test/meta/settings';
  let o = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(o.page);
  check(await o.page.locator('#ep-offer').isVisible(), 'compte existant : proposition d\'activer l\'épargne');
  check(await o.page.locator('[data-act="add-type"][data-type="epargne"]').isHidden(), 'épargne pas encore activée : pas de bouton Épargne');
  check(await o.page.evaluate(() => window.__PFLOW_DB__.writes()) === 0, 'rien n\'est écrit tant qu\'on ne choisit pas');
  await o.page.click('[data-act="ep-offer"][data-v="1"]');
  await until(o.page, k => window.__PFLOW_DB__.dump()[k].epargne === true, SET, '« Activer » : épargne activée');
  await until(o.page, () => document.getElementById('ep-offer').hidden, null, 'proposition retirée');
  check(await o.page.locator('[data-act="add-type"][data-type="epargne"]').isVisible(), 'bouton Épargne affiché');
  const s = (await dump(o.page))[SET];
  check(s.pro === true && s.taux['2026'] === 21.2 && s.periodicite === 'mensuelle' && s.createdAt === fx.docs[SET].createdAt, 'les autres réglages sont intacts');
  noErr(o.errors);
  await o.ctx.close();
  o = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(o.page);
  await o.page.click('[data-act="ep-offer"][data-v="0"]');
  await until(o.page, k => window.__PFLOW_DB__.dump()[k].epargne === false, SET, '« Non merci » : choix enregistré (plus proposé sur les autres appareils)');
  await until(o.page, () => document.getElementById('ep-offer').hidden, null, 'proposition retirée');
  await o.ctx.close();
}

// Demande d'accès : la personne demande, l'administrateur accepte ou refuse dans l'appli.
async function scenarioDemandes(cfg, fx, tag) {
  const REQ = 'demandes/test@example.invalid';
  let o = await open(cfg, fx.docs, { date: fx.expect._date, denied: true });
  const page = o.page;
  await until(page, () => !document.getElementById('s-denied').hidden, null, 'écran « accès pas encore autorisé »');
  await page.fill('#req-msg', 'C\'est le voisin');
  await page.click('#req-send');
  await until(page, k => !!window.__PFLOW_DB__.dump()[k], REQ, 'demande enregistrée');
  const d = (await dump(page))[REQ];
  check(d.uid === 'uid-test' && d.message === 'C\'est le voisin' && typeof d.at === 'number' && Object.keys(d).sort().join() === 'at,message,nom,uid', 'demande : seulement uid, message, nom et date');
  check(await page.evaluate(() => window.__PFLOW_DB__.writes()) === 1, 'demande : rien d\'autre n\'est écrit');
  await until(page, () => document.getElementById('req-intro').textContent.includes('envoyée'), null, 'confirmation « demande envoyée »');
  await page.screenshot({ path: join(OUT, tag + '-demande.png') });
  // L'administrateur accepte depuis un autre appareil : l'appli s'ouvre toute seule
  await page.evaluate(() => window.__PFLOW_DB__.set('allowlist/test@example.invalid', { addedAt: 1 }));
  await until(page, () => !document.getElementById('app').hidden, null, 'accès accordé : l\'appli s\'ouvre toute seule');
  noErr(o.errors, 'demande');
  await o.ctx.close();

  // Côté administrateur
  const docs = Object.assign({}, fx.docs, {
    'demandes/ami@example.invalid': { uid: 'uid-ami', message: 'Coucou', nom: 'Ami', at: Date.parse('2026-03-14') },
    'demandes/autre@example.invalid': { uid: 'uid-autre', message: '', nom: '', at: Date.parse('2026-03-14T10:00:00Z') },
  });
  o = await open(cfg, docs, { date: fx.expect._date, admin: true });
  await waitApp(o.page);
  await until(o.page, () => !document.getElementById('req-banner').hidden && document.getElementById('req-banner').textContent.includes('ami@example.invalid'), null, 'administrateur : bandeau de demande d\'accès');
  await o.page.click('#req-banner [data-act="req-accept"]');
  await until(o.page, () => { const d = window.__PFLOW_DB__.dump(); return 'allowlist/ami@example.invalid' in d && !('demandes/ami@example.invalid' in d); }, null, 'Accepter : ajouté à la liste, demande retirée');
  await reglages(o.page, 'admin');
  await until(o.page, () => document.getElementById('req-list').textContent.includes('autre@example.invalid'), null, 'Administration : demande restante listée');
  const ref = o.page.locator('#req-list [data-act="req-refuse"][data-email="autre@example.invalid"]');
  await ref.click();
  check('demandes/autre@example.invalid' in (await dump(o.page)), 'Refuser demande une confirmation');
  await o.page.locator('#req-list [data-act="req-refuse"][data-email="autre@example.invalid"]').click();
  await until(o.page, () => !('demandes/autre@example.invalid' in window.__PFLOW_DB__.dump()), null, 'Refuser : demande retirée');
  check(!('allowlist/autre@example.invalid' in (await dump(o.page))), 'Refuser : pas ajouté à la liste');
  noErr(o.errors, 'administrateur');
  await o.ctx.close();
}

// Nouveautés après une mise à jour : affichées une seule fois, retrouvables dans Réglages → À propos.
async function scenarioNouveautes(cfg, fx, tag) {
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: fx.expect._date, news: true });
  await waitApp(page);
  await until(page, () => !document.getElementById('panel-bg').hidden, null, 'nouveautés affichées à la première ouverture');
  check((await page.locator('#panel-title').innerText()).includes('Nouveautés'), 'titre « Nouveautés »');
  check(await page.locator('#panel-body li').count() > 3, 'contenu des notes de version');
  await page.screenshot({ path: join(OUT, tag + '-nouveautes.png') });
  await page.click('#panel-close');
  await until(page, () => document.getElementById('panel-bg').hidden, null, 'fenêtre des nouveautés fermée');
  check(await page.evaluate(() => localStorage.getItem('pf-nouveautes')) === NOTES_VERSION, 'nouveautés marquées comme vues sur cet appareil');
  check(await page.evaluate(() => window.__PFLOW_DB__.writes()) === 0, 'rien n\'est écrit dans le compte');
  await page.reload();
  await waitApp(page); await page.waitForTimeout(1200);
  check(await page.locator('#panel-bg').isHidden(), 'pas de nouveautés à la réouverture');
  await reglages(page, 'apropos');
  await page.click('[data-act="news"]');
  await until(page, () => !document.getElementById('panel-bg').hidden, null, '« À propos de cette mise à jour » rouvre les nouveautés');
  noErr(errors);
  await ctx.close();
}

// Apparence (propre à l'appareil) : thème, noir absolu, taille du texte, effets réduits.
async function scenarioApparence(cfg, fx, tag) {
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(page);
  const attr = n => page.evaluate(n => document.documentElement.getAttribute(n), n);
  const bgc = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await reglages(page, 'apparence');
  await page.click('[data-act="theme"][data-t="sombre"]');
  check(await attr('data-scheme') === 'dark', 'thème sombre appliqué');
  await page.click('#noir-toggle');
  check(await attr('data-noir') === '' && await bgc() === 'rgb(0, 0, 0)', 'noir absolu : fond noir pur');
  await page.screenshot({ path: join(OUT, tag + '-noir.png'), fullPage: true });
  await page.click('[data-act="theme"][data-t="clair"]');
  check(await attr('data-scheme') === 'light' && await bgc() !== 'rgb(0, 0, 0)', 'thème clair : le noir absolu ne s\'applique pas');
  const fs0 = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  await page.click('[data-act="texte"][data-t="grand"]');
  const fs1 = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  check(fs1 > fs0, 'grand texte (' + fs0 + ' → ' + fs1 + ' px)');
  await page.click('#effets-toggle');
  check(await attr('data-effets') === 'reduits', 'effets réduits');
  const ls = await page.evaluate(() => [localStorage.getItem('pf-theme'), localStorage.getItem('pf-noir'), localStorage.getItem('pf-texte'), localStorage.getItem('pf-effets')].join());
  check(ls === 'clair,1,grand,reduits', 'apparence gardée sur cet appareil (' + ls + ')');
  check(await page.evaluate(() => window.__PFLOW_DB__.writes()) === 0, 'apparence : rien n\'est écrit dans le compte');
  await page.reload();
  await waitApp(page);
  check(await attr('data-scheme') === 'light' && await attr('data-texte') === 'grand' && await attr('data-noir') === '', 'apparence retrouvée après rechargement');
  // Couleur d'accentuation : enregistrée dans le compte (la même sur tous les appareils), appliquée tout de suite
  await reglages(page, 'apparence');
  const btnBg = () => page.locator('#ctx .back').evaluate(e => getComputedStyle(e).color); // le bouton « Réglages » prend la couleur d'accentuation
  const bg0 = await btnBg();
  await page.click('[data-act="accent"][data-a="violet"]');
  check(await attr('data-accent') === 'violet' && await btnBg() !== bg0, 'couleur d\'accentuation appliquée tout de suite');
  await until(page, () => window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].accent === 'violet', null, 'couleur d\'accentuation enregistrée dans le compte');
  const S1 = (await dump(page))['users/uid-test/meta/settings'], S0 = fx.docs['users/uid-test/meta/settings'];
  check(S1.pro === S0.pro && S1.taux['2026'] === S0.taux['2026'] && S1.createdAt === S0.createdAt && JSON.stringify(S1.couleurs) === JSON.stringify(S0.couleurs), 'les autres réglages sont intacts');
  check(await page.evaluate(() => localStorage.getItem('pf-accent')) === 'violet', 'couleur gardée pour l\'ouverture suivante');
  await page.click('[data-act="accent"][data-a="bleu"]');
  await until(page, () => window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].accent === 'bleu' && !document.documentElement.hasAttribute('data-accent'), null, 'retour au bleu');
  noErr(errors);
  await ctx.close();
}

// Navigation : barre en pilule, sous-pages des Réglages, glisser pour changer de mois.
async function scenarioNavigation(cfg, fx, tag) {
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(page);
  if (cfg.isMobile && cfg.viewport.width < 900) {
    // Glisser vers la gauche → mois suivant ; vers la droite → mois précédent
    const swipe = async dx => page.evaluate(dx => {
      const h = document.getElementById('v-mois'), r = h.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + 200;
      const ev = (t, cx) => h.dispatchEvent(new PointerEvent(t, { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: cx, clientY: y, bubbles: true }));
      ev('pointerdown', x); for (let i = 1; i <= 6; i++) ev('pointermove', x + dx * i / 6); ev('pointerup', x + dx);
    }, dx);
    await swipe(-160);
    await until(page, () => document.querySelector('#ctx h1').textContent === 'Avril 2026', null, 'glisser à gauche : mois suivant');
    await swipe(160); await swipe(160);
    await until(page, () => document.querySelector('#ctx h1').textContent === 'Février 2026', null, 'glisser à droite : mois précédent');
    await swipe(30);
    await page.waitForTimeout(200);
    check(await page.locator('#ctx h1').innerText() === 'Février 2026', 'petit glissement : rien ne change');
    check(await page.locator('.tabbar .fab').isVisible(), 'bouton + au centre de la barre');
    await reglages(page);
    await until(page, () => getComputedStyle(document.querySelector('.tabbar .fab')).opacity === '0', null, 'bouton + masqué dans Réglages');
  }
  await reglages(page, 'partage');
  check(await page.locator('#share-apk').isVisible(), 'Partager P-Flow : liens affichés');
  await page.click('[data-act="sub-back"]');
  await until(page, () => !document.getElementById('set-home').hidden, null, 'retour à la liste des réglages');
  noErr(errors);
  await ctx.close();
}

// Refaire la configuration : ajoute sans rien supprimer ni changer ce qui n'est pas touché.
async function scenarioRefaireConfig(cfg, fx, tag) {
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(page);
  await reglages(page, 'compte');
  await page.click('[data-act="redo-setup"]');
  await until(page, () => !document.getElementById('s-onboard').hidden, null, 'configuration rouverte');
  check(await page.locator('#o-profile [data-pro="1"][aria-pressed="true"]').count() === 1, 'profil actuel prérempli (auto-entrepreneur)');
  await page.click('#ob-skip'); // profil inchangé
  await page.click('#ob-skip'); // revenus
  check((await page.locator('#ob-step').innerText()).includes('Déjà notés'), 'charges fixes déjà notées rappelées');
  await page.click('#ob-step [data-ob="add"][data-l="Internet"]');
  await page.fill('#ob-step .ob-row [data-f="amount"]', '30');
  await page.click('#ob-next');
  for (let i = 0; i < 3; i++) await page.click(i === 2 ? '#ob-next' : '#ob-skip');
  await until(page, () => !document.getElementById('app').hidden, null, 'retour à l\'appli');
  await until(page, () => Object.values(window.__PFLOW_DB__.dump()).some(v => v.label === 'Internet' && v.amount === 30 && v.start === '2026-03' && v.end === null), null, 'charge ajoutée');
  const db = await dump(page), S0 = fx.docs['users/uid-test/meta/settings'], S1 = db['users/uid-test/meta/settings'];
  check(S1.pro === true && S1.taux['2026'] === 21.2 && S1.periodicite === S0.periodicite && S1.createdAt === S0.createdAt, 'réglages inchangés');
  for (const [path, d] of Object.entries(fx.docs)) check(path in db && Object.keys(d).every(f => f in db[path]), 'rien de supprimé : ' + path);
  noErr(errors);
  await ctx.close();
}

// ---------- lancement ----------
// Un scénario qui plante compte comme un échec, et les suivants continuent.
async function run(fn, name) {
  try { await fn(); } catch (e) { check(false, 'scénario ' + (name || '') + ' interrompu : ' + String(e.message).split('\n')[0]); if (process.env.DEBUG) console.log(String(e.message).split('\n').slice(0, 30).join('\n')); }
}
const fixtures = readdirSync(join(ROOT, 'tests/fixtures')).filter(f => f.endsWith('.json')).sort();
const onlyFx = process.env.FX ? new RegExp(process.env.FX) : null; // ex. FX=0.1.2
const onlyCfg = process.env.CFG ? new RegExp(process.env.CFG) : null; // ex. CFG=PC
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // ex. ONLY=Epargne pour un seul scénario
let current = '';
const go = async (name, fn) => { if (!only || only.test(name)) { current = name; await run(fn, name); } };
for (const file of fixtures) {
  const fx = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures', file), 'utf8'));
  if (onlyFx && !onlyFx.test(file)) continue;
  const last = file === fixtures[fixtures.length - 1];
  const oldFormat = !('epargne' in fx.docs['users/uid-test/meta/settings']);
  for (const cfg of CONFIGS.filter(c => !onlyCfg || onlyCfg.test(c.name))) {
    const tag = file.replace('.json', '') + '-' + cfg.name.replace(/\s+/g, '-');
    const before = failures;
    console.log('▶ ' + file + ' · ' + cfg.name);
    await go('Donnees', () => scenarioDonnees(cfg, fx, tag));
    await go('LectureSeule', () => scenarioLectureSeule(cfg, fx, tag));
    await go('Saisie', () => scenarioSaisie(cfg, fx, tag));
    await go('Couleurs', () => scenarioCouleurs(cfg, fx, tag));
    await go('Acces', () => scenarioAcces(cfg, fx, tag));
    await go('Sauvegardes', () => scenarioSauvegardes(cfg, fx, tag));
    await go('MisesAJour', () => scenarioMisesAJour(cfg, fx, tag));
    if (fx.expect.epargne) await go('Epargne', () => scenarioEpargne(cfg, fx, tag));
    if (oldFormat) await go('OffreEpargne', () => scenarioOffreEpargne(cfg, fx, tag));
    if (cfg.name === 'téléphone clair') await go('RefaireConfig', () => scenarioRefaireConfig(cfg, fx, tag));
    if (last) {
      await go('Demandes', () => scenarioDemandes(cfg, fx, tag));
      await go('Nouveautes', () => scenarioNouveautes(cfg, fx, tag));
      await go('Apparence', () => scenarioApparence(cfg, fx, tag));
      await go('Navigation', () => scenarioNavigation(cfg, fx, tag));
    }
    console.log(failures === before ? '   ✓ ok' : '   ✗ ' + (failures - before) + ' échec(s)');
  }
}
for (const cfg of CONFIGS.filter(c => c.name === 'téléphone clair' || c.name === 'PC clair')) {
  const before = failures;
  console.log('▶ nouveau compte · ' + cfg.name);
  await go('NouveauCompte', () => scenarioNouveauCompte(cfg, 'nouveau-' + cfg.name.replace(/\s+/g, '-')));
  console.log(failures === before ? '   ✓ ok' : '   ✗ échec');
}

await browser.close();
server.close();
console.log('\n' + (failures ? '✗ ' + failures + ' échec(s) sur ' + checks + ' vérifications' : '✓ ' + checks + ' vérifications réussies'));
process.exit(failures ? 1 : 0);
