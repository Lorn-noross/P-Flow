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
  console.log('   ✗ ' + label);
}
async function until(page, fn, arg, label) {
  try { await page.waitForFunction(fn, arg, { timeout: 5000 }); check(true, label); }
  catch (e) { check(false, label + ' (délai dépassé)'); }
}
const dump = page => page.evaluate(() => window.__PFLOW_DB__.dump());

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
  await page.addInitScript(([s, noUser, tok]) => { window.__PFLOW_SEED__ = s; window.__PFLOW_NO_USER__ = noUser; if (tok) window.__PFLOW_DRIVE_TOKEN__ = tok; }, [seed, !!opts.noUser, opts.driveToken || null]);
  await page.goto(URL_APP);
  return { ctx, page, errors };
}
async function waitApp(page) {
  await until(page, () => { const a = document.getElementById('app'); const h = document.getElementById('hero-amount'); return a && !a.hidden && h && h.textContent !== '…'; }, null, 'l\'appli s\'affiche');
}
const txt = (page, sel) => page.locator(sel).first().innerText().then(clean);
const legend = page => page.$$eval('#legend > div', ds => ds.map(d => [d.querySelector('dt').innerText.trim(), d.querySelector('dd').innerText]));

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
  for (const l of ['Facture client A', 'Remboursement', 'Aide', 'Courses']) check(await page.locator('#lists .row', { hasText: l }).count() === 1, 'ligne « ' + l + ' » affichée');
  check(await page.locator('#lists', { hasText: 'Charges fixes · 1' }).count() === 1, 'une charge fixe active (l\'abonnement terminé est exclu)');
  await page.screenshot({ path: join(OUT, tag + '-mois.png'), fullPage: true });

  // Année : totaux
  await page.locator('[data-act="view"][data-view="annee"]:visible').click();
  await until(page, () => !document.getElementById('v-annee').hidden && !document.getElementById('kpis').innerText.includes('…'), null, 'vue Année affichée');
  const K = clean(await page.locator('#kpis').innerText());
  for (const k of ['brut', 'urssaf', 'net', 'dep', 'reste']) check(K.includes(eur(E.annee2026[k])), 'total année ' + k + ' = ' + eur(E.annee2026[k]));
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
  await until(page, v => document.getElementById('hero-amount').textContent.replace(/[\s  ]/g, '') === v, eur(318), 'reste recalculé après modifications');

  check(errors.length === 0, 'aucune erreur dans la console' + (errors.length ? ' : ' + errors.join(' | ') : ''));
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

  await page.locator('[data-act="view"][data-view="reglages"]:visible').click();
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
  check(await css('#chart .b-dep', 'fill') === 'rgb(194, 59, 53)', 'vue Année : barres des dépenses à la nouvelle couleur');

  await page.locator('[data-act="view"][data-view="reglages"]:visible').click();
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
  await o.page.locator('[data-act="view"][data-view="reglages"]:visible').click();
  check(await o.page.locator('#admin-card').isHidden(), 'non-administrateur : pas de gestion des accès');
  await o.ctx.close();

  o = await open(cfg, fx.docs, { date: fx.expect._date, admin: true });
  const page = o.page;
  await waitApp(page);
  await page.locator('[data-act="view"][data-view="reglages"]:visible').click();
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
  const reglages = p => p.locator('[data-act="view"][data-view="reglages"]:visible').click();

  // 1. Exporter : un fichier avec tout le compte
  let o = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(o.page); await reglages(o.page);
  const [dl] = await Promise.all([o.page.waitForEvent('download'), o.page.click('[data-act="backup-export"]')]);
  // Nom de fichier sans accent : Chromium sans écran refuse les chemins accentués pour l'envoi de fichier.
  const file = join(OUT, tag.normalize('NFD').replace(/[\u0300-\u036f]/g, '') + '-sauvegarde.json');
  await dl.saveAs(file);
  const bk = JSON.parse(readFileSync(file, 'utf8'));
  check(bk.app === 'P-Flow' && bk.dataVersion === 1 && bk.entries.length === 4 && bk.recurring.length === 3, 'export : toutes les opérations et tous les fixes');
  check(bk.entries.find(e => e.id === 'e2').champFutur === 'à conserver' && bk.settings.pro === true, 'export : champs et réglages complets');
  check(/^p-flow-sauvegarde-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}\.json$/.test(dl.suggestedFilename()), 'export : nom de fichier daté');
  await o.ctx.close();

  // 2. Importer dans un compte où il manque des choses, et où une opération a été modifiée depuis
  const docs = JSON.parse(JSON.stringify(fx.docs));
  delete docs[E3]; delete docs[R2]; docs[E2].amount = 99;
  o = await open(cfg, docs, { date: fx.expect._date });
  await waitApp(o.page); await reglages(o.page);
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
  await waitApp(page); await reglages(page);
  await page.click('[data-act="drive-connect"]');
  await until(page, () => { const s = window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].sauvegarde; return s && s.drive === true && s.derniere > 0; }, null, 'Drive : connecté, date de la copie enregistrée dans le compte');
  const folders = drive.files.filter(f => f.folder), copies = () => drive.files.filter(f => !f.folder && !f.trashed);
  check(folders.length === 1 && folders[0].name === 'P-Flow Sauvegardes', 'Drive : dossier « P-Flow Sauvegardes » créé');
  check(copies().length === 1 && JSON.parse(copies()[0].content).entries.length === 4, 'Drive : première copie complète');
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
  await o.page.locator('[data-act="view"][data-view="reglages"]:visible').click();
  check((await o.page.locator('#upd-status').innerText()).includes('0.1.1 bêta'), 'Réglages : nouvelle version annoncée');
  await o.page.selectOption('#upd-auto', 'semaine');
  check(await o.page.evaluate(() => localStorage.getItem('pf-maj-auto')) === 'semaine', 'Réglages : intervalle de vérification enregistré');
  await o.ctx.close();
  o = await open(cfg, fx.docs, { date: fx.expect._date });
  await waitApp(o.page);
  await o.page.locator('[data-act="view"][data-view="reglages"]:visible').click();
  await o.page.click('#upd-check');
  await until(o.page, () => document.getElementById('upd-status').textContent.includes('dernière version'), null, 'vérification manuelle : « Tu as la dernière version »');
  check(await o.page.locator('#update').isHidden(), 'pas de bandeau sans nouvelle version');
  check(o.errors.length === 0, 'aucune erreur dans la console' + (o.errors.length ? ' : ' + o.errors.join(' | ') : ''));
  await o.ctx.close();
}

async function scenarioNouveauCompte(cfg, tag) {
  const { ctx, page, errors } = await open(cfg, {}, { date: '2026-03-15' });
  await until(page, () => !document.getElementById('s-onboard').hidden, null, 'écran de bienvenue pour un nouveau compte');
  await page.screenshot({ path: join(OUT, tag + '-bienvenue.png') });
  check(errors.length === 0, 'aucune erreur dans la console' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await ctx.close();
}

// ---------- lancement ----------
// Un scénario qui plante compte comme un échec, et les suivants continuent.
async function run(fn) {
  try { await fn(); } catch (e) { check(false, 'scénario interrompu : ' + String(e.message).split('\n')[0]); }
}
const fixtures = readdirSync(join(ROOT, 'tests/fixtures')).filter(f => f.endsWith('.json')).sort();
for (const file of fixtures) {
  const fx = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures', file), 'utf8'));
  for (const cfg of CONFIGS) {
    const tag = file.replace('.json', '') + '-' + cfg.name.replace(/\s+/g, '-');
    const before = failures;
    console.log('▶ ' + file + ' · ' + cfg.name);
    await run(() => scenarioDonnees(cfg, fx, tag));
    await run(() => scenarioLectureSeule(cfg, fx, tag));
    await run(() => scenarioSaisie(cfg, fx, tag));
    await run(() => scenarioCouleurs(cfg, fx, tag));
    await run(() => scenarioAcces(cfg, fx, tag));
    await run(() => scenarioSauvegardes(cfg, fx, tag));
    await run(() => scenarioMisesAJour(cfg, fx, tag));
    console.log(failures === before ? '   ✓ ok' : '   ✗ ' + (failures - before) + ' échec(s)');
  }
}
for (const cfg of CONFIGS.filter(c => c.name === 'téléphone clair' || c.name === 'PC clair')) {
  const before = failures;
  console.log('▶ nouveau compte · ' + cfg.name);
  await run(() => scenarioNouveauCompte(cfg, 'nouveau-' + cfg.name.replace(/\s+/g, '-')));
  console.log(failures === before ? '   ✓ ok' : '   ✗ échec');
}

await browser.close();
server.close();
console.log('\n' + (failures ? '✗ ' + failures + ' échec(s) sur ' + checks + ' vérifications' : '✓ ' + checks + ' vérifications réussies'));
process.exit(failures ? 1 : 0);
