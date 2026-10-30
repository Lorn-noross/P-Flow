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
  // Patch 5 (point 30) : grand écran (trois colonnes, Année sur une page)
  { name: 'grand écran sombre', viewport: { width: 1920, height: 1080 }, colorScheme: 'dark', only: /^Patch5/ },
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
  // Patch 6 : la visite guidée et le rappel du solde ne s'ouvrent pas d'eux-mêmes pendant les autres tests (scénario Patch6 à part).
  const ls = Object.assign(opts.news ? {} : { 'pf-nouveautes': NOTES_VERSION }, { 'pf-tuto': 'vu', 'pf-solde-plus-tard': opts.date + '|fin' }, opts.ls || {});
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
// Cascade du mois (Brut → URSSAF → Autres revenus → Net → Dépenses → Épargne → Reste) : libellé seul
// (sans le signe −, = ou +, ni la petite note « dont X € de fixes » ajoutée au patch 3).
const legend = page => page.$$eval('#legend > div', ds => ds.map(d => { const c = d.querySelector('dt .cl') || d.querySelector('dt'); return [(c.firstChild && c.firstChild.nodeType === 3 ? c.firstChild.textContent : c.innerText).replace(/^[\s−=+]+/, '').trim(), d.querySelector('dd').innerText]; }));
const num = s => parseFloat(clean(s).replace('€', '').replace(',', '.'));
const r2 = n => Math.round(n * 100) / 100;
// Gros chiffre du mois : « Prévu sur ton compte » quand un solde du compte est noté (patch 3), sinon le reste.
const heroExp = E => (E.mars.compte != null ? E.mars.compte : E.mars.reste);
// Patch 3 : les revenus fixes sont rangés dans une ligne repliable « Revenus fixes · N ».
async function openFixedRev(page) {
  const t = page.locator('#lists [data-act="toggle-fixed-rev"]');
  if (await t.count() && await t.getAttribute('aria-expanded') !== 'true') { await t.click(); await page.waitForTimeout(150); }
}
// Patch 3 : « Déjà passée sur ton compte ? » (opération datée avant le dernier solde noté) : répondre si posée.
async function answerPassed(page, yes = true) {
  await page.waitForTimeout(600);
  if (await page.locator('#panel-bg').isVisible() && (await page.locator('#panel-title').innerText()).includes('passée')) {
    await page.locator('#panel-body [data-act="pt"][data-v="' + (yes ? 1 : 0) + '"]').first().click();
    await page.waitForTimeout(400);
  }
}

// ---------- scénarios ----------
async function scenarioDonnees(cfg, fx, tag) {
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: fx.expect._date });
  const E = fx.expect;
  await waitApp(page);

  // Mois : montants
  check(await txt(page, '#hero-amount') === eur(heroExp(E)), (E.mars.compte != null ? 'prévu sur le compte = ' : 'reste du mois = ') + eur(heroExp(E)));
  const L = Object.fromEntries((await legend(page)).map(([k, v]) => [k.replace(/\s*\(.*\)/, ''), clean(v)]));
  // Patch 3 : « Revenus bruts » = revenus soumis à l'URSSAF ; les autres sur leur propre ligne (calculs inchangés).
  const rate = fx.docs['users/uid-test/meta/settings'].taux['2026'] / 100, baseM = r2(E.mars.urssaf / rate);
  check(L['Revenus bruts'] === eur(baseM), 'revenus bruts = revenus soumis à l\'URSSAF (' + L['Revenus bruts'] + ')');
  check(r2(baseM + (L['Autres revenus'] ? num(L['Autres revenus']) : 0)) === E.mars.brut && (E.mars.brut > baseM) === ('Autres revenus' in L), 'revenus sans URSSAF sur leur propre ligne (total ' + eur(E.mars.brut) + ')');
  check(L['URSSAF'] === eur(E.mars.urssaf), 'URSSAF');
  check(L['Revenus nets'] === eur(E.mars.net), 'revenus nets');
  check(L['Dépenses'] === eur(E.mars.dep), 'dépenses');
  if (E.mars.ep != null) check(L['Épargne'] === eur(E.mars.ep), 'épargne du mois = ' + eur(E.mars.ep));
  else check(!('Épargne' in L), 'pas de ligne Épargne sans épargne');
  check((L['Reste'] || '') === eur(E.mars.reste), 'reste du mois dans la cascade = ' + eur(E.mars.reste));
  for (const l of ['Facture client A', 'Remboursement', 'Courses']) check(await page.locator('#lists .row', { hasText: l }).count() === 1, 'ligne « ' + l + ' » affichée');
  check(await page.locator('#lists', { hasText: 'Revenus fixes · ' }).count() === 1, 'revenus fixes rangés dans « Revenus fixes · N »');
  await openFixedRev(page);
  check(await page.locator('#lists .row', { hasText: 'Aide' }).count() === 1, 'ligne « Aide » affichée (revenus fixes dépliés)');
  const nf = E.chargesFixes || 1;
  check(await page.locator('#lists', { hasText: 'Charges fixes · ' + nf }).count() === 1, nf + ' charge(s) fixe(s) ce mois-ci (l\'abonnement terminé est exclu)');
  await page.screenshot({ path: join(OUT, tag + '-mois.png'), fullPage: true });

  // Année : totaux
  await page.locator('[data-act="view"][data-view="annee"]:visible').click();
  await until(page, () => !document.getElementById('v-annee').hidden && !document.getElementById('kpis').innerText.includes('…'), null, 'vue Année affichée');
  // Patch 5 : avec un solde noté, l'Année suit l'interrupteur « Sur mon compte » ; les totaux se lisent en « Reste de l'année ».
  if (await page.locator('#kpis [data-act="hero-mode"][data-v="reste"]').count()) {
    await page.click('#kpis [data-act="hero-mode"][data-v="reste"]');
    await until(page, () => /l'année$/.test(document.querySelector('#kpis .eyebrow').textContent), null, 'Année : « Reste de l\'année »');
    // Le gros chiffre défile d'une vue à l'autre (rollNumber, 520 ms) : attendre la valeur finale.
    await until(page, v => document.querySelector('#kpis .big').textContent.replace(/\s/g, '').includes(v), eur(Math.abs(E.annee2026.reste)), 'Année : gros chiffre arrivé');
  }
  const K = clean(await page.locator('#kpis').innerText());
  // Patch 4 : avec une URSSAF payée (montant réel ≠ estimation), le jeu donne directement le chiffre d'affaires.
  const baseY = E.annee2026.base != null ? E.annee2026.base : r2(E.annee2026.urssaf / rate);
  check(K.includes('Revenusbruts' + eur(baseY)) && (E.annee2026.brut > baseY ? K.includes('Autresrevenus' + eur(r2(E.annee2026.brut - baseY))) : !K.includes('Autresrevenus')), 'année : revenus bruts (soumis à l\'URSSAF) ' + eur(baseY) + ' + autres revenus');
  for (const k of ['urssaf', 'net', 'dep']) if (E.annee2026[k] != null) check(K.includes(eur(E.annee2026[k])), 'total année ' + k + ' = ' + eur(E.annee2026[k]));
  // Patch 5 (point 23) : une seule case « Épargne : total (+X € cette année) ».
  if (E.annee2026.ep) check(K.includes((E.annee2026.ep > 0 ? '+' : '-') + clean(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.abs(Math.round(E.annee2026.ep)))) + 'cetteannée'), 'épargne de l\'année = ' + eur(E.annee2026.ep));
  check(K.includes(eur(Math.abs(E.annee2026.reste))) && K.includes(E.annee2026.reste < 0 ? 'manque' : 'Reste'), 'reste de l\'année = ' + eur(E.annee2026.reste));
  await page.screenshot({ path: join(OUT, tag + '-annee.png'), fullPage: true });
  if (await page.locator('#kpis [data-act="hero-mode"][data-v="compte"]').count()) await page.click('#kpis [data-act="hero-mode"][data-v="compte"]'); // remet le choix d'avant
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
  await openFixedRev(page);
  await page.locator('#lists .row', { hasText: 'Aide' }).click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre du fixe ouverte');
  await page.fill('#f-amount', '120');
  // Patch 4 : la phrase ne s'affiche qu'après un vrai changement (patch 3) : on la vérifie après la saisie.
  await until(page, () => document.getElementById('f-hint').textContent.includes('Ce changement compte'), null, 'avertissement « Ce changement compte à partir de… » affiché');
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
  const apres = E.apresModifCompte != null ? E.apresModifCompte : E.apresModif != null ? E.apresModif : 318;
  await until(page, v => document.getElementById('hero-amount').textContent.replace(/[\s  ]/g, '').replace(/−/g, '-') === v, eur(apres), 'gros chiffre recalculé après modifications (' + eur(apres) + ')');
  await until(page, v => document.querySelector('#legend .tot dd').textContent.replace(/[\s  ]/g, '').replace(/−/g, '-') === v, eur(E.apresModif != null ? E.apresModif : 318), 'reste recalculé après modifications');

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
  check(clean(await page.locator('#hero-amount').innerText()) === eur(heroExp(fx.expect)), 'les données restent consultables');
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
  // Patch 3 : + Autres revenus, Fixes et Épargne (si l'épargne est suivie).
  const nCol = fx.docs[SET].epargne === true ? 8 : 7;
  await until(page, n => document.querySelectorAll('#colors .color-head').length === n, nCol, nCol + ' couleurs réglables (profil auto-entrepreneur)');
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
  await until(page, () => !!document.querySelector('#y-top .bar i.p'), null, 'vue Année : « Où part l\'argent » affiché');
  // Patch 4 : ponctuelles dans la couleur des Dépenses, fixes dans celle des Fixes (légende assortie).
  check(await css('#y-top .bar i.p', 'backgroundColor') === 'rgb(194, 59, 53)', 'vue Année : dépenses ponctuelles à la nouvelle couleur');
  check(await page.evaluate(() => { const i = document.querySelector('#y-top .bar i.f'), l = document.querySelector('.mini-legend .s-fixes'); return !!i && !!l && getComputedStyle(i).backgroundColor === getComputedStyle(l).backgroundColor; }), 'vue Année : charges fixes dans la couleur des Fixes, comme la légende');

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
  check(bk.app === 'P-Flow' && bk.format === 5 && bk.dataVersion === 1 && bk.entries.length === NB.entries && bk.recurring.length === NB.recurring, 'export : toutes les opérations et tous les fixes');
  // Patch 4 : format 4, avec les paiements de l'URSSAF (liste vide s'il n'y en a pas).
  check(Array.isArray(bk.urssaf) && bk.urssaf.length === (NB.urssaf || 0), 'export : paiements de l\'URSSAF (' + (NB.urssaf || 0) + ')');
  check(bk.periodiques.length === (NB.periodiques || 0) && bk.epargne.length === (NB.epargne || 0), 'export : fixes non mensuels et épargne (' + bk.periodiques.length + ', ' + bk.epargne.length + ')');
  check(bk.entries.find(e => e.id === 'e2').champFutur === 'à conserver' && bk.settings.pro === true, 'export : champs et réglages complets');
  check(['jours', 'soldes', 'pointages'].every(c => Array.isArray(bk[c]) && bk[c].length === (NB[c] || 0)), 'export : jours des fixes, soldes du compte et pointages (patch 3)');
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
  // Patch 4 : une seule ligne qui ouvre un petit menu en verre (5 choix, dont « une fois par mois »).
  check((await o.page.locator('#upd-auto').innerText()).includes('Une fois par jour'), 'Réglages : vérification automatique « Une fois par jour » d\'office');
  await o.page.click('#upd-auto');
  await until(o.page, () => document.querySelectorAll('.pop [role="option"]').length === 5, null, 'Réglages : menu de la vérification automatique (5 choix)');
  check(await o.page.locator('.pop [role="option"][data-v="jour"][aria-selected="true"]').count() === 1, 'Réglages : choix en cours coché');
  check(await o.page.locator('select').count() === 0, 'Réglages : pas de liste du système');
  await o.page.click('.pop [data-v="mois"]');
  await until(o.page, () => !document.querySelector('.pop') && document.getElementById('upd-auto').textContent.includes('Une fois par mois'), null, 'Réglages : « Une fois par mois » choisi, menu refermé');
  check(await o.page.evaluate(() => localStorage.getItem('pf-maj-auto')) === 'mois', 'Réglages : intervalle de vérification enregistré');
  await o.page.click('#upd-auto'); await until(o.page, () => !!document.querySelector('.pop [data-v="semaine"]'), null, 'Réglages : menu rouvert');
  await o.page.keyboard.press('Escape');
  await until(o.page, () => !document.querySelector('.pop'), null, 'Réglages : Échap referme sans rien changer');
  check(await o.page.evaluate(() => localStorage.getItem('pf-maj-auto')) === 'mois', 'Réglages : rien changé en refermant');
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
  check(clean(await page.locator('#o-pro').innerText()).includes('tape21,98%'), 'patch 5 : aide du taux « Artisan (ex. électricien) : tape 21,98 % »');
  await page.fill('#o-rate', '21,2');
  await page.click('#ob-next');
  // 2. Revenus fixes : passer
  await until(page, () => document.getElementById('ob-count').textContent.includes('2 sur 6'), null, 'étape 2 sur 6 (plus d\'étape « L\'apparence »)');
  await page.click('#ob-skip');
  // 3. Charges fixes : boutons rapides (libellé modifiable) et charge au libellé libre
  await page.click('[data-ob="add"][data-l="Loyer"]');
  await page.fill('.ob-row[data-i="0"] [data-f="amount"]', '650');
  await page.click('[data-ob="add"][data-l="Assurance"]');
  await page.fill('.ob-row[data-i="1"] [data-f="amount"]', '300');
  // Patch 3 : plus de liste native, une pilule de choix aux couleurs de l'appli
  await page.click('.ob-row[data-i="1"] [data-ob="freq"]');
  await until(page, () => !!document.querySelector('.pop [role="option"][data-v="annee"]'), null, 'pilule de choix de la fréquence ouverte');
  await page.click('.pop [role="option"][data-v="annee"]');
  await until(page, () => !document.querySelector('.pop') && document.querySelector('.ob-row[data-i="1"] [data-ob="freq"]').textContent.includes('Annuel'), null, 'fréquence « Annuel » choisie');
  await page.click('[data-ob="add"][data-k="dep"][data-l=""]');
  await page.fill('.ob-row[data-i="2"] [data-f="label"]', 'Cantine des enfants');
  await page.click('#ob-next');
  check((await page.locator('#o-error').innerText()).includes('Cantine'), 'montant manquant signalé');
  await page.fill('.ob-row[data-i="2"] [data-f="amount"]', '45,50');
  await page.click('#ob-next');
  // 4. Compte en banque (patch 3, facultatif) : 1 500 € aujourd'hui
  await until(page, () => !!document.getElementById('o-solde'), null, 'étape « Ton compte en banque »');
  await page.click('#ob-step [data-ob="sign"][data-n="1"]');
  await page.click('#ob-step [data-ob="sign"][data-n="0"]');
  await page.fill('#o-solde', '1 500');
  await page.click('#ob-next');
  // 4. Épargne : Livret A, solde 1 200 €, 50 € chaque mois
  await page.click('[data-ob="ep"][data-v="1"]');
  await page.click('[data-ob="add"][data-k="ep"][data-l="Livret A"]');
  await page.fill('.ob-row[data-i="0"] [data-f="amount"]', '1 200');
  await page.fill('.ob-row[data-i="0"] [data-f="auto"]', '50');
  await page.click('#ob-next');
  // 5. Patch 5 : plus d'étape « L'apparence » (Réglages → Apparence)
  check(!(await page.locator('#ob-step').innerText()).includes('apparence'), 'pas d\'étape « L\'apparence »');
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
  check(of('soldes', v => v.montant === 1500 && v.date === '2026-03-15') === 1, 'solde du compte courant noté au 15 mars');
  check(Object.keys(db).filter(k => k.startsWith(U)).length === 7, 'rien d\'autre n\'est écrit');
  await page.waitForTimeout(1200);
  check(await page.locator('#panel-bg').isHidden(), 'pas de « nouveautés » pour un nouveau compte');
  // Mars : aucun revenu, 650 + 300 + 45,50 de charges (le versement automatique commence en avril)
  await waitReste(page, -995.5, 'reste du mois du nouveau compte');
  await waitHero(page, 1500, 'prévu sur le compte le 31 (les fixes sont comptés au 1er, déjà passés)');
  await page.screenshot({ path: join(OUT, tag + '-apres-config.png') });
  noErr(errors);
  await ctx.close();
}

// ---------- patch 2 ----------
const hero = page => page.locator('#hero-amount').innerText().then(clean);
const waitHero = (page, v, label) => until(page, x => document.getElementById('hero-amount').textContent.replace(/[\s  ]/g, '').replace(/−/g, '-') === x, eur(v), label);
// Reste du mois lu dans la cascade (le gros chiffre peut être « Prévu sur ton compte » depuis le patch 3).
const reste = page => page.locator('#legend .tot dd').innerText().then(clean);
const waitReste = (page, v, label) => until(page, ([x, neg]) => { const r = document.querySelector('#legend .tot'); if (!r) return false; const d = r.querySelector('dd').textContent.replace(/[\s\u00a0\u202f]/g, ''); return d === x && r.querySelector('dt').textContent.includes('manque') === neg; }, [eur(Math.abs(v)), v < 0], label); // négatif : ligne « Il manque », montant sans signe

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
  await openFixedRev(page);
  check(await page.locator('#lists .row', { hasText: 'Prime' }).count() === 1, 'fixe trimestriel compté le mois où il tombe (Prime)');
  check(await page.locator('#lists .row', { hasText: 'Assurance auto' }).count() === 0, 'fixe trimestriel absent hors échéance (Assurance auto)');

  // Fixes : moyenne par mois et prochaine échéance
  await page.locator('[data-act="view"][data-view="fixes"]:visible').click();
  await until(page, () => !document.getElementById('v-fixes').hidden, null, 'vue Fixes');
  const ft = clean(await page.locator('#fix-totals').innerText());
  const F = E.fixesParMois;
  check(ft.includes(eur(Math.abs(F.reste))) && ft.includes(F.reste < 0 ? 'ilmanque' : 'iltereste') && ft.includes(eur(F.charges)) && ft.includes(eur(F.revenus)) && ft.includes(eur(F.epargne)), 'Fixes : « après les fixes » et moyennes par mois (' + ft.slice(0, 80) + ')');
  check(await page.locator('#fix-list .row', { hasText: 'Assurance auto' }).filter({ hasText: 'prochaine : avril 2026' }).count() === 1, 'Fixes : prochaine échéance du trimestriel (avril 2026)');
  check(await page.locator('#fix-list .row', { hasText: 'Assurance habitation' }).filter({ hasText: 'ce mois-ci' }).count() === 1, 'Fixes : échéance de l\'annuel ce mois-ci');

  // Nouveau fixe trimestriel depuis Fixes (bouton +)
  await page.locator('[data-act="add"]:visible').click();
  await until(page, () => !document.getElementById('sheet-bg').hidden && !document.getElementById('f-when-field').hidden && document.getElementById('f-when-label').textContent.includes('partir'), null, 'Fixes : + ouvre « Nouveau fixe »');
  await page.click('#freq-seg [data-f="trimestre"]');
  await page.fill('#f-amount', '90'); await page.fill('#f-label', 'Taxe trimestrielle');
  await page.click('#f-save');
  await until(page, p => Object.entries(window.__PFLOW_DB__.dump()).some(([k, v]) => k.startsWith(p) && v.label === 'Taxe trimestrielle' && v.freq === 'trimestre' && v.start === '2026-03' && v.type === 'depense' && v.end === null), PER, 'fixe trimestriel enregistré dans « periodiques »');
  let db = await dump(page);
  check(!Object.values(db).some(v => v.label === 'Taxe trimestrielle' && 'month' in v), 'le fixe trimestriel n\'est pas dans « recurring » ni « entries »');

  // Retour au mois : la taxe compte en mars
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  await waitReste(page, E.mars.reste - 90, 'reste de mars avec le nouveau trimestriel');

  // Modifier le fixe trimestriel en cours de route : l'ancien s'arrête, le nouveau garde le cycle et les champs inconnus
  await openFixedRev(page);
  await page.locator('#lists .row', { hasText: 'Prime' }).click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre du fixe trimestriel');
  await page.fill('#f-amount', '350');
  await until(page, () => document.getElementById('f-hint').textContent.includes('Ce changement compte'), null, 'avertissement « Ce changement compte à partir de… » (trimestriel)');
  await page.click('#f-save');
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
  const nw = fx.docs['users/uid-test/jours/r1'] ? 3 : 2; // + le jour du fixe, repris sur le nouveau (patch 3)
  check(await page.evaluate(() => window.__PFLOW_DB__.writes()) - w0 === nw, 'changement de fréquence : ' + nw + ' écritures ensemble, rien d\'autre');
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  await waitReste(page, E.mars.reste - 90 + 50, 'mars inchangé par le passage au trimestriel');

  // Ajouter de l'épargne avec le bouton rond « Épargne »
  await page.click('[data-act="add-type"][data-type="epargne"]');
  await until(page, () => !document.getElementById('sheet-bg').hidden && !document.getElementById('op-seg').hidden, null, 'bouton Épargne : fenêtre en mode épargne');
  await page.fill('#f-amount', '20'); await page.fill('#f-label', 'Livret A'); await page.click('#f-save');
  await until(page, p => Object.entries(window.__PFLOW_DB__.dump()).some(([k, v]) => k.startsWith(p) && v.op === 'depot' && v.amount === 20 && v.month === '2026-03' && v.label === 'Livret A'), EP, 'dépôt d\'épargne enregistré');
  await waitReste(page, E.mars.reste - 90 + 50 - 20, 'le dépôt baisse le reste du mois');

  // Modifier un dépôt garde les champs inconnus
  await page.locator('#lists .row', { hasText: 'Livret A' }).filter({ hasText: '8 mars' }).click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre de modification du dépôt');
  check(await page.locator('#type-seg').isHidden() && await page.locator('#op-seg [data-op="depot"][aria-pressed="true"]').count() === 1, 'modification d\'épargne : type figé, « J\'ai mis de côté » choisi');
  await page.fill('#f-amount', '160'); await page.click('#f-save');
  await until(page, k => (window.__PFLOW_DB__.dump()[k] || {}).amount === 160, EP + 'ep2', 'dépôt modifié');
  db = await dump(page);
  check(db[EP + 'ep2'].champFutur === 'épargne à conserver' && db[EP + 'ep2'].op === 'depot' && db[EP + 'ep2'].createdAt === fx.docs[EP + 'ep2'].createdAt, 'dépôt : champ inconnu et date de création conservés');

  // Un solde (« J'ai actuellement ») ne change pas le reste
  await waitReste(page, E.mars.reste - 90 + 50 - 20 - 10, 'dépôt modifié pris en compte');
  const before = await reste(page);
  await page.click('[data-act="add-type"][data-type="epargne"]');
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre épargne');
  await page.click('#op-seg [data-op="solde"]');
  check(await page.locator('#f-freq-field').isHidden(), 'solde : pas de fréquence');
  await page.fill('#f-amount', '5100'); await page.fill('#f-label', 'PEL'); await page.click('#f-save');
  await until(page, p => Object.entries(window.__PFLOW_DB__.dump()).some(([k, v]) => k.startsWith(p) && v.op === 'solde' && v.amount === 5100), EP, 'solde enregistré');
  await page.waitForTimeout(600);
  check(await reste(page) === before, 'un solde ne change pas le reste du mois');
  await until(page, () => document.getElementById('ep-card').innerText.replace(/[\s  ]/g, '').includes('5100,00€'), null, 'nouveau solde du PEL affiché');

  // Désactiver l'épargne : plus affichée ni comptée, données gardées
  await reglages(page, 'compte');
  await page.click('#ep-toggle');
  await until(page, () => window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].epargne === false, null, 'épargne désactivée dans le compte');
  db = await dump(page);
  check(Object.keys(db).filter(k => k.startsWith(EP)).length === (E.nb ? E.nb.epargne : 4) + 2, 'épargne désactivée : les opérations d\'épargne restent enregistrées');
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
  // Haut de l'écran : pas de barre opaque, titre (et nuage sur téléphone) dans des pilules en verre.
  const topInfo = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.top'));
    return { bg: cs.backgroundColor, pe: cs.pointerEvents, pillTop: document.querySelector('#ctx .pill').getBoundingClientRect().top,
      sync: getComputedStyle(document.querySelector('.top .sync')).display !== 'none' };
  });
  check(topInfo.bg === 'rgba(0, 0, 0, 0)' && topInfo.pe === 'none', 'barre du haut transparente, elle laisse passer les touchers');
  check(topInfo.sync === (cfg.viewport.width < 900), 'nuage de synchronisation en pilule (téléphone) ou dans la colonne (PC)');
  // Android 15+ : la page passe sous la barre d'état, dont la hauteur arrive dans --sat.
  await page.evaluate(() => document.documentElement.style.setProperty('--sat', '30px'));
  const pillTop2 = await page.evaluate(() => document.querySelector('#ctx .pill').getBoundingClientRect().top);
  check(Math.round(pillTop2 - topInfo.pillTop) === 30, 'pilules sous la barre d\'état (--sat)');
  await page.evaluate(() => document.documentElement.style.removeProperty('--sat'));
  if (await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 300)) {
    await page.evaluate(() => window.scrollTo(0, 260));
    await until(page, () => document.querySelector('.top').classList.contains('scrolled'), null, 'fondu en haut quand le contenu passe dessous');
    await page.evaluate(() => window.scrollTo(0, 0));
    await until(page, () => !document.querySelector('.top').classList.contains('scrolled'), null, 'pas de fondu en haut de la page');
  }
  await reglages(page, 'partage');
  check(await page.locator('#share-apk').isVisible(), 'Partager P-Flow : liens affichés');
  check(await page.locator('#ctx .back.pill').isVisible(), 'sous-page : bouton retour en pilule');
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
  for (let i = 0; i < 3; i++) await page.click(i === 2 ? '#ob-next' : '#ob-skip'); // compte, épargne, sauvegarde
  await until(page, () => !document.getElementById('app').hidden, null, 'retour à l\'appli');
  await until(page, () => Object.values(window.__PFLOW_DB__.dump()).some(v => v.label === 'Internet' && v.amount === 30 && v.start === '2026-03' && v.end === null), null, 'charge ajoutée');
  const db = await dump(page), S0 = fx.docs['users/uid-test/meta/settings'], S1 = db['users/uid-test/meta/settings'];
  check(S1.pro === true && S1.taux['2026'] === 21.2 && S1.periodicite === S0.periodicite && S1.createdAt === S0.createdAt, 'réglages inchangés');
  for (const [path, d] of Object.entries(fx.docs)) check(path in db && Object.keys(d).every(f => f in db[path]), 'rien de supprimé : ' + path);
  noErr(errors);
  await ctx.close();
}

// ---------- patch 3 ----------
// Solde du compte courant, « déjà passée ? », calendriers maison, jour des fixes, URSSAF retenue par libellé,
// suppression d'un fixe avec historique, « Annuler », comptes d'épargne, mois à venir. Jeu de données 0.1.3.
async function scenarioPatch3(cfg, fx, tag) {
  const E = fx.expect, U = 'users/uid-test/';
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: E._date });
  await waitApp(page);
  const sub = () => page.locator('#hero-sub').innerText().then(clean);
  const sheetOpen = () => until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre d\'ajout ouverte');
  const sheetClosed = () => until(page, () => document.getElementById('sheet-bg').hidden, null, 'fenêtre fermée');
  const natives = () => page.evaluate(() => document.querySelectorAll('select, input[type="date"], input[type="month"], input[type="color"], datalist').length);

  // 1. Gros chiffre : prévu sur le compte le 31, aujourd'hui, point le plus bas
  check(clean(await page.locator('#hero-label').innerText()) === 'Prévusurtoncomptele31mars', 'gros chiffre : « Prévu sur ton compte le 31 mars »');
  check(await hero(page) === eur(E.mars.compte), 'prévu le 31 = ' + eur(E.mars.compte));
  let sb = await sub();
  // Patch 4 (retour sur l'APK 65) : le solde noté porte sa date. Patch 5 : une seule ligne « Solde du 10 mars : X € · Mettre à jour » ;
  // plus de « Prévu aujourd'hui » ni de « Tu peux encore dépenser » (carte Fin du mois), point le plus bas seulement s'il passe sous 0.
  check(sb === 'Soldedu10mars:' + eur(1250) + '·Mettreàjour', 'une seule ligne : « Solde du 10 mars : ' + eur(1250) + ' · Mettre à jour » (' + sb.slice(0, 120) + ')');
  check(clean(await page.locator('#hero-sub [data-act="solde-open"]').innerText()) === 'Mettreàjour', 'lien « Mettre à jour »');
  check(E.compte.bas < 0 ? sb.includes('Pointleplusbas') : !sb.includes('Pointleplusbas'), 'point le plus bas seulement en alerte (' + eur(E.compte.bas) + ')');
  check((L => L.includes('Reste'))(await page.locator('#legend').innerText()), 'le reste du mois reste dans la cascade');
  await page.screenshot({ path: join(OUT, tag + '-compte.png'), fullPage: true });

  // 2. Petites explications de la cascade
  await page.click('#legend [data-act="info"][data-k="urssaf"]');
  await until(page, () => { const p = document.querySelector('#legend .cexp'); return !!p && p.textContent.length > 20; }, null, 'ⓘ URSSAF : explication affichée');
  await page.click('#legend [data-act="info"][data-k="urssaf"]');
  await until(page, () => !document.querySelector('#legend .cexp'), null, 'ⓘ : un second toucher referme');

  // 3. Calendrier du mois (pilule du mois) : pastilles, bulle du jour, + à cette date
  await page.click('#ctx .mtitle');
  await until(page, () => !!document.querySelector('.pop .cal-d[data-d="20"]'), null, 'calendrier du mois ouvert');
  check(await page.locator('.pop .cal-d[data-d="20"] .cdot').count() > 0, 'pastille le 20 (Assurance habitation, jour du fixe)');
  check(await page.locator('.pop .cal-d[data-d="5"] .cdot.d-fix').count() > 0, 'pastille « fixe » le 5 (Loyer)');
  await page.click('.pop .cal-d[data-d="20"]');
  await until(page, () => { const b = document.querySelector('.day-bubble'); return !!b && b.textContent.includes('Assurance habitation'); }, null, 'bulle du 20 : Assurance habitation');
  await page.screenshot({ path: join(OUT, tag + '-calendrier-mois.png') });
  await page.keyboard.press('Escape');
  await until(page, () => !document.querySelector('.pop'), null, 'Échap referme le calendrier');
  check(await page.locator('#sheet-bg').isHidden(), 'Échap n\'ouvre ni ne ferme rien d\'autre');

  // 4. Noter un nouveau solde : signe −, historique, puis reposer la question pour « pas encore passée »
  await page.click('[data-act="solde-open"]');
  await until(page, () => !document.getElementById('panel-bg').hidden && document.getElementById('panel-title').textContent.includes('compte en banque'), null, 'fenêtre « Mon compte en banque »');
  check(await page.locator('#panel-body .row.static').count() === E.nb.soldes, 'historique des soldes notés (' + E.nb.soldes + ')');
  await page.click('[data-act="sd-sign"][data-n="1"]');
  await page.fill('#sd-amount', '75,5');
  await page.click('[data-act="sd-save"]');
  await until(page, p => Object.entries(window.__PFLOW_DB__.dump()).some(([k, v]) => k.startsWith(p) && v.montant === -75.5 && v.date === '2026-03-15'), U + 'soldes/', 'solde à découvert enregistré (−75,50 € le 15 mars)');
  await until(page, () => !document.getElementById('panel-bg').hidden && document.getElementById('panel-title').textContent.includes('passées'), null, 'question reposée pour l\'opération « pas encore passée »');
  check((await page.locator('#panel-body').innerText()).includes('Remboursement'), 'question : Remboursement du 10 mars');
  await page.locator('#panel-body .pt-row [data-act="pt"][data-v="1"]').click();
  await until(page, k => (window.__PFLOW_DB__.dump()[k] || {}).passee === true, U + 'pointages/e3', '« Oui » : opération marquée passée');
  await page.click('#panel-close');
  // 1 250 → nouveau solde −75,50 le 15 ; ensuite −50 (18), −180 (20), +100 (25) : −205,50 le 31
  await waitHero(page, -205.5, 'prévu le 31 recalculé depuis le nouveau solde');
  sb = await sub();
  check(sb.includes('découvert'), 'compte à découvert signalé');
  check(await page.locator('#hero-amount.neg').count() === 1, 'gros chiffre en rouge quand le compte est prévu sous 0');
  let db = await dump(page);
  for (const [path, d] of Object.entries(fx.docs)) if (path.includes('/soldes/')) check(JSON.stringify(db[path]) === JSON.stringify(d), 'ancien solde intact : ' + path);

  // 5. Opération datée avant le dernier solde : « Elle était déjà passée ? » → Non, pas encore
  await page.locator('[data-act="add"]:visible').click(); await sheetOpen();
  check(await natives() === 0, 'aucune liste, date ou couleur native dans la fenêtre d\'ajout');
  await page.click('#f-when');
  await until(page, () => !!document.querySelector('.pop .cal-d[data-d="12"]'), null, 'calendrier maison de la date');
  await page.click('.pop .cal-d[data-d="12"]');
  check(await page.inputValue('#f-date') === '2026-03-12', 'date choisie au calendrier (12 mars)');
  await page.fill('#f-amount', '10'); await page.fill('#f-label', 'Pain'); await page.click('#f-save');
  await until(page, () => !document.getElementById('panel-bg').hidden && document.getElementById('panel-title').textContent.includes('Déjà passée'), null, 'question « Déjà passée sur ton compte ? »');
  await page.locator('#panel-body [data-act="pt"][data-v="0"]').click();
  await until(page, () => { const d = window.__PFLOW_DB__.dump(); const e = Object.entries(d).find(([k, v]) => k.includes('/entries/') && v.label === 'Pain'); return e && (d['users/uid-test/pointages/' + e[0].split('/').pop()] || {}).passee === false; }, null, '« Non, pas encore » rangé à part (pointages), pas dans l\'opération');
  db = await dump(page);
  const pain = Object.entries(db).find(([k, v]) => k.includes('/entries/') && v.label === 'Pain');
  check(pain && Object.keys(pain[1]).sort().join() === 'amount,createdAt,date,label,month,type,urssaf', 'l\'opération n\'a que les champs habituels');
  await waitHero(page, -215.5, '« pas encore passée » : retirée du prévu');

  // 6. URSSAF retenue par libellé
  await page.click('[data-act="add-type"][data-type="revenu"]'); await sheetOpen();
  await page.fill('#f-label', 'Remboursement'); await page.waitForTimeout(150);
  check(!(await page.isChecked('#f-urssaf')), 'libellé déjà utilisé sans URSSAF : case décochée');
  await page.fill('#f-label', 'Facture client A'); await page.waitForTimeout(150);
  check(await page.isChecked('#f-urssaf'), 'libellé déjà utilisé avec URSSAF : case cochée');
  await page.fill('#f-label', 'Tout nouveau client'); await page.waitForTimeout(150);
  check(await page.isChecked('#f-urssaf'), 'libellé jamais utilisé : cochée d\'office');
  await page.click('#sheet-close'); await sheetClosed();

  // 7. Fixe avec un jour : rangé à part (jours), jamais dans recurring
  await page.locator('[data-act="add"]:visible').click(); await sheetOpen();
  await page.click('#freq-seg [data-f="mois"]');
  check((await page.locator('#f-when-label').innerText()).includes('partir'), 'fixe : « À partir de »');
  await page.click('#f-when');
  await until(page, () => !!document.querySelector('.pop .cal-d[data-d="9"]'), null, 'calendrier du fixe');
  await page.click('.pop .cal-d[data-d="9"]');
  check((await page.locator('#f-when-txt').innerText()).includes('9 mars 2026'), 'jour du fixe affiché (9 mars 2026)');
  check(await page.locator('#f-preview').isHidden(), 'fixe mensuel : pas de phrase en double (la fréquence et la date sont déjà affichées)');
  await page.click('#freq-seg [data-f="trimestre"]');
  check((await page.locator('#f-preview').innerText()).includes('Tombe en mars, juin, sept. et déc.'), 'fixe trimestriel : seulement les mois où il tombe');
  await page.click('#freq-seg [data-f="mois"]');
  await page.fill('#f-amount', '15'); await page.fill('#f-label', 'Cantine'); await page.click('#f-save');
  await until(page, () => Object.values(window.__PFLOW_DB__.dump()).some(v => v.label === 'Cantine' && v.start === '2026-03'), null, 'fixe enregistré');
  db = await dump(page);
  const cant = Object.entries(db).find(([k, v]) => k.includes('/recurring/') && v.label === 'Cantine');
  check(cant && !('jour' in cant[1]) && Object.keys(cant[1]).sort().join() === 'amount,createdAt,end,label,start,type,urssaf', 'recurring : seulement les champs habituels');
  check(cant && (db[U + 'jours/' + cant[0].split('/').pop()] || {}).jour === 9, 'jour du fixe rangé à part (jours/{id} = 9)');

  // 8. Fixe commencé avant ce mois : « Arrêter » en principal, « Supprimer aussi des mois passés »
  await page.locator('[data-act="view"][data-view="fixes"]:visible').click();
  await until(page, () => !document.getElementById('v-fixes').hidden, null, 'vue Fixes');
  await page.locator('#fix-list .row', { hasText: 'Loyer' }).click(); await sheetOpen();
  check(await page.locator('#f-stop.lead:visible').count() === 1, '« Arrêter après… » en bouton principal');
  check((await page.locator('#f-delete').innerText()).includes('mois passés'), '« Supprimer aussi des mois passés »');
  check(await page.locator('#f-hint:visible').count() === 0 || !(await page.locator('#f-hint').innerText()).includes('Ce changement compte'), 'pas de phrase « Ce changement compte… » sans changement');
  await page.click('#sheet-close'); await sheetClosed();

  // 8a. Couleurs : Fixes, Épargne et Autres revenus réglables ; une couleur déjà prise est bloquée
  await reglages(page, 'apparence');
  for (const k of ['autres', 'fixes', 'ep']) {
    check(await page.locator('#colors [data-act="color-open"][data-k="' + k + '"]').count() === 1, 'couleur réglable : ' + k);
    check(await page.locator('#colors [data-k="' + k + '"] i.sw').evaluate(e => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)'), 'carré de couleur visible : ' + k);
  }
  await page.click('#colors [data-act="color-open"][data-k="fixes"]');
  const gris = page.locator('#colors [data-act="color-set"][data-k="fixes"][data-c="#6a7d90"]');
  check(await gris.isDisabled() && (await gris.getAttribute('aria-label')).includes('Dépenses'), 'gris déjà pris par « Dépenses » : bloqué pour Fixes');
  const w8 = await page.evaluate(() => window.__PFLOW_DB__.writes());
  // Patch 4 : le bouton est réactivé à la main pour vérifier que l'appli refuse elle-même (un clic sur un bouton désactivé ne fait rien).
  await page.evaluate(() => { const b = document.querySelector('#colors [data-act="color-set"][data-k="fixes"][data-c="#6a7d90"]'); b.disabled = false; b.click(); });
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__PFLOW_DB__.writes()) === w8, 'couleur prise : rien n\'est enregistré');
  await page.click('#colors [data-act="color-set"][data-k="fixes"][data-c="#d9488f"]');
  await until(page, () => ((window.__PFLOW_DB__.dump()['users/uid-test/meta/settings'].couleurs) || {}).fixes === '#d9488f', null, 'couleur des fixes enregistrée (rose)');
  check(JSON.stringify((await dump(page))['users/uid-test/meta/settings'].couleurs.reste) === JSON.stringify(fx.docs['users/uid-test/meta/settings'].couleurs.reste), 'les autres couleurs ne changent pas');
  await page.locator('[data-act="view"][data-view="fixes"]:visible').click();
  await until(page, () => !document.getElementById('v-fixes').hidden, null, 'retour à la vue Fixes');

  // 8b. Changer seulement le jour d'un fixe : jours/{id} mis à jour en fusion (champ inconnu gardé), le fixe ne bouge pas
  await page.locator('#fix-list .row', { hasText: 'Aide' }).click(); await sheetOpen();
  await page.click('#f-when');
  await until(page, () => !!document.querySelector('.pop .cal-d[data-d="26"]'), null, 'calendrier du fixe Aide');
  check((await page.locator('.pop .cal-title').innerText()).includes('Janvier 2026'), 'calendrier ouvert sur le mois de départ du fixe');
  await page.click('.pop .cal-d[data-d="26"]');
  check(!(await page.locator('#f-hint').innerText()).includes('départ passe'), 'même mois de départ : pas d\'avertissement');
  await page.click('#f-save');
  await until(page, k => (window.__PFLOW_DB__.dump()[k] || {}).jour === 26, U + 'jours/r3', 'jour du fixe changé (26)');
  db = await dump(page);
  check(db[U + 'jours/r3'].champFutur === 'jour à conserver' && db[U + 'jours/r3'].createdAt === fx.docs[U + 'jours/r3'].createdAt, 'jours/r3 : champ inconnu et date de création gardés');
  check(JSON.stringify(db[U + 'recurring/r3']) === JSON.stringify(fx.docs[U + 'recurring/r3']), 'le fixe lui-même n\'a pas changé');
  // Choisir un jour d'un autre mois change le départ : avertissement avant d'enregistrer
  await page.locator('#fix-list .row', { hasText: 'Aide' }).click(); await sheetOpen();
  await page.click('#f-when');
  await until(page, () => !!document.querySelector('.pop [data-c="today"]'), null, 'calendrier rouvert');
  await page.click('.pop [data-c="today"]');
  await until(page, () => document.getElementById('f-hint').textContent.includes('départ passe de janvier 2026 à mars 2026'), null, 'avertissement : le départ change et les mois d\'avant ne compteront plus');
  await page.click('#sheet-close'); await sheetClosed();
  check(JSON.stringify((await dump(page))[U + 'recurring/r3']) === JSON.stringify(fx.docs[U + 'recurring/r3']), 'fermer sans enregistrer : rien ne change');

  // 9. Supprimer puis « Annuler » : remis à l'identique (champs inconnus compris)
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  await page.locator('#lists .row', { hasText: 'Courses' }).click(); await sheetOpen();
  await page.click('#f-delete'); await page.click('#f-delete');
  await until(page, k => !(k in window.__PFLOW_DB__.dump()), U + 'entries/e2', 'opération supprimée');
  await until(page, () => !!document.querySelector('#toast:not([hidden]) .toast-undo'), null, 'message avec « Annuler »');
  await page.click('#toast .toast-undo');
  await until(page, ([k, v]) => JSON.stringify(window.__PFLOW_DB__.dump()[k]) === v, [U + 'entries/e2', JSON.stringify(fx.docs[U + 'entries/e2'])], '« Annuler » : opération remise à l\'identique');

  // 10. Épargne : choix du compte, nouveau compte avec ce qu'il y a déjà dessus, total et explication
  // Patch 5 : l'explication du total dans un ⓘ ; le total n'est plus répété sous « Épargne du mois ».
  check(!(await page.locator('#ep-card').innerText()).includes('fin du mois'), 'carte Épargne : explication repliée dans un ⓘ');
  await page.click('#ep-card [data-act="info"][data-k="ep-card"]');
  await until(page, () => { const p = document.querySelector('#ep-card .cexp'); return !!p && p.textContent.includes('fin du mois'); }, null, 'ⓘ de la carte Épargne : explication du total');
  check(!clean(await page.locator('#lists').innerText()).includes('Totalsurtescomptes'), 'plus de « Total sur tes comptes » répété sous l\'épargne du mois');
  await page.click('[data-act="add-type"][data-type="epargne"]'); await sheetOpen();
  check(await page.locator('#f-accounts [data-acc="LDDS"]').count() === 1 && await page.locator('#f-accounts [data-acc="Livret A"]').count() === 1, 'comptes existants proposés en pilules');
  await page.click('#f-accounts [data-acc="LDDS"]');
  check(await page.inputValue('#f-label') === 'LDDS' && await page.locator('#f-epstart-field').isHidden(), 'compte existant choisi (pas de solde de départ demandé)');
  await page.click('#f-accounts [data-acc=""]');
  await page.fill('#f-label', 'Livret jeune'); await page.dispatchEvent('#f-label', 'input');
  await until(page, () => !document.getElementById('f-epstart-field').hidden, null, 'nouveau compte : « Combien as-tu déjà dessus ? »');
  await page.fill('#f-epstart', '100'); await page.fill('#f-amount', '20'); await page.click('#f-save');
  await answerPassed(page, true);
  await until(page, () => Object.values(window.__PFLOW_DB__.dump()).filter(v => v.label === 'Livret jeune').length === 2, null, 'nouveau compte : solde de départ et dépôt enregistrés');
  db = await dump(page);
  const lj = Object.values(db).filter(v => v.label === 'Livret jeune');
  const sol = lj.find(v => v.op === 'solde'), dep = lj.find(v => v.op === 'depot');
  check(sol && dep && sol.amount === 100 && dep.amount === 20 && sol.date === dep.date && sol.createdAt < dep.createdAt, 'solde de départ noté avant le dépôt');
  await until(page, () => document.getElementById('ep-card').innerText.includes('Livret jeune'), null, 'nouveau compte dans la carte Épargne');
  check(clean(await page.locator('#ep-card .row', { hasText: 'Livret jeune' }).innerText()).includes(eur(120)), 'Livret jeune = 120 € (100 déjà dessus + 20)');

  // 10b. Interrupteur du gros chiffre : « Reste du mois » sans compter le solde, puis retour
  await until(page, () => !document.getElementById('hero-mode').hidden, null, 'interrupteur « Sur mon compte / Reste du mois » affiché');
  await page.click('#hero-mode [data-act="hero-mode"][data-v="reste"]');
  await until(page, () => document.getElementById('hero-label').textContent === 'Reste du mois', null, 'interrupteur : « Reste du mois »');
  await until(page, () => { const r = document.querySelector('#legend .tot'), c = t => t.replace(/[\s\u00a0\u202f]/g, '').replace(/−/g, '-');
    return c(document.getElementById('hero-amount').textContent) === (r.querySelector('dt').textContent.includes('manque') ? '-' : '') + c(r.querySelector('dd').textContent); }, null, 'le gros chiffre redevient le reste du mois');
  check(await page.evaluate(() => localStorage.getItem('pf-vue-compte')) === '0', 'choix gardé sur cet appareil');
  await page.click('#hero-mode [data-act="hero-mode"][data-v="compte"]');
  await until(page, () => document.getElementById('hero-label').textContent.includes('Prévu sur ton compte'), null, 'interrupteur : retour à « Prévu sur ton compte »');

  // 11. Année : total épargné par mois ; choix de l'année ; mois à venir en prévision
  await page.locator('[data-act="view"][data-view="annee"]:visible').click();
  await until(page, () => !document.getElementById('v-annee').hidden && document.querySelector('#v-annee table') && document.querySelector('#v-annee table').innerText.includes('total'), null, 'Année : colonne Épargne (total)');
  if (cfg.viewport.width < 600) check(await page.locator('#y-table').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'tableau de l\'année entier sur téléphone (rien de coupé)');
  await page.click('#ctx [data-act="year-pick"]');
  await until(page, () => !!document.querySelector('.pop [data-y="2025"]'), null, 'choix de l\'année ouvert');
  await page.click('.pop .cal-m[data-y="2025"]');
  await until(page, () => document.querySelector('#ctx h1').textContent.trim() === '2025', null, 'année 2025 choisie');
  await page.click('#ctx [data-act="year-pick"]'); await page.click('.pop .link[data-y]');
  await until(page, () => document.querySelector('#ctx h1').textContent.trim() === '2026', null, '« Cette année » : retour en 2026');
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  await page.click('[data-act="next-month"]');
  // Patch 5 : le gros chiffre suit l'interrupteur aussi pour un mois à venir.
  await until(page, () => document.getElementById('hero-label').textContent.replace(/\s/g, ' ') === 'Prévu sur ton compte le 30 avril' && document.getElementById('hero-amount').classList.contains('fut'), null, 'mois à venir : « Prévu sur ton compte le 30 avril », en gris');
  await page.click('#hero-mode [data-act="hero-mode"][data-v="reste"]');
  await until(page, () => document.getElementById('hero-label').textContent.includes('Prévu pour avril') && document.getElementById('hero-amount').classList.contains('fut'), null, 'mois à venir, « Reste du mois » : « Prévu pour avril », en gris');
  await page.click('#hero-mode [data-act="hero-mode"][data-v="compte"]');
  check(await natives() === 0, 'aucune fenêtre native dans la page');
  await page.screenshot({ path: join(OUT, tag + '-avril.png'), fullPage: true });

  // Tout ce qui existait est encore là (sauf ce qu'on a supprimé puis remis)
  db = await dump(page);
  for (const [path, d] of Object.entries(fx.docs)) {
    check(path in db, 'document toujours présent : ' + path);
    if (path in db) for (const f of Object.keys(d)) check(f in db[path], 'champ « ' + f + ' » toujours présent dans ' + path);
  }
  noErr(errors);
  await ctx.close();
}

// ---------- patch 4 : URSSAF payée, objectif de fin de mois, épargne possible (jeu 0.1.4) ----------
const EUR0T = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur0 = n => clean(EUR0T.format(Math.round(n)));
async function scenarioPatch4(cfg, fx, tag) {
  const E = fx.expect, P = E.patch4, U = 'users/uid-test/', ST = U + 'meta/settings';
  let { ctx, page, errors } = await open(cfg, fx.docs, { date: E._date });
  await waitApp(page);
  const fin = () => page.locator('#fin-card').innerText().then(clean);
  const panelOpen = t => until(page, x => !document.getElementById('panel-bg').hidden && document.getElementById('panel-title').textContent.includes(x), t, 'fenêtre « ' + t + ' »');
  const cas = async () => Object.fromEntries((await legend(page)).map(([k, v]) => [k.replace(/\s*\(.*\)/, ''), clean(v)]));
  const urssafNote = () => page.locator('#legend > div', { hasText: 'URSSAF' }).first().locator('small').innerText().catch(() => '');
  const urssafIs = (v, label) => until(page, x => { const r = Array.from(document.querySelectorAll('#legend > div')).find(d => d.textContent.includes('URSSAF')); return !!r && r.querySelector('dd').textContent.replace(/[\s  ]/g, '') === x; }, eur(v), label);

  // 1. Février : l'URSSAF payée (110 €) remplace l'estimation (106 €) dans la cascade, avec la mention « montant réel »
  await page.click('[data-act="prev-month"]');
  await until(page, () => document.querySelector('#ctx h1').textContent.includes('Février'), null, 'février affiché');
  let L = await cas();
  check(L['URSSAF'] === eur(P.fevrierReel), 'février : URSSAF = montant réel payé ' + eur(P.fevrierReel) + ' (' + L['URSSAF'] + ')');
  check((await urssafNote()) === 'montant réel', 'février : mention « montant réel »');
  await page.click('#legend [data-act="info"][data-k="urssaf"]');
  await until(page, v => { const p = document.querySelector('#legend .cexp'); return !!p && p.textContent.includes('réellement payé') && p.textContent.replace(/[\s  ]/g, '').includes(v); }, eur(P.fevrierEstime), 'ⓘ URSSAF : montant payé, estimation de ' + eur(P.fevrierEstime));
  await page.click('[data-act="urssaf-toggle"]');
  await until(page, () => document.getElementById('urssaf-line').textContent.includes('Payée le 12'), null, 'ligne URSSAF de février : « payée le 12 mars »');
  check(clean(await page.locator('#uc-info').innerText()).includes('estimation:' + eur(P.fevrierEstime)), 'carte URSSAF : montant réel et estimation');
  // Modifier le paiement : la date, la création et un champ ajouté par une version plus récente sont gardés
  await page.click('#uc-info [data-act="up-open"]');
  await panelOpen('URSSAF de février');
  check(await page.inputValue('#up-amount') === '110', 'montant payé pré-rempli (110)');
  await page.fill('#up-amount', '115'); await page.click('[data-act="up-save"]');
  await until(page, k => (window.__PFLOW_DB__.dump()[k] || {}).montant === 115, U + 'urssaf/2026-02', 'paiement modifié (115 €)');
  let db = await dump(page);
  const pf = db[U + 'urssaf/2026-02'];
  check(pf.champFutur === 'paiement à conserver' && pf.date === '2026-03-12' && pf.createdAt === fx.docs[U + 'urssaf/2026-02'].createdAt, 'paiement modifié : date, création et champ inconnu gardés');
  // Retirer le paiement (confirmation en deux temps) puis « Annuler » : remis à l'identique
  await page.click('#uc-info [data-act="up-open"]'); await panelOpen('URSSAF de février');
  await page.click('[data-act="up-del"]');
  check(await page.locator('[data-act="up-del"].armed').count() === 1, 'retirer le paiement : confirmation demandée');
  await page.click('[data-act="up-del"]');
  await until(page, k => !(k in window.__PFLOW_DB__.dump()), U + 'urssaf/2026-02', 'paiement retiré');
  await urssafIs(P.fevrierEstime, 'sans paiement : l\'estimation revient (' + eur(P.fevrierEstime) + ')');
  await page.click('#toast .toast-undo');
  await until(page, k => (window.__PFLOW_DB__.dump()[k] || {}).champFutur === 'paiement à conserver', U + 'urssaf/2026-02', '« Annuler » : paiement remis à l\'identique');
  await urssafIs(115, 'paiement remis : 115 € dans la cascade');
  await page.click('[data-act="urssaf-toggle"]');
  await page.click('[data-act="next-month"]');
  await until(page, () => document.querySelector('#ctx h1').textContent.includes('Mars'), null, 'retour en mars');

  // 2. Mars : prévu le 31 avec l'URSSAF de février payée 115 € le 12 ; carte « Fin du mois »
  const end = r2(E.mars.compte - 5), possible = P.epargnePossible - 5; // paiement de février passé de 110 à 115 €
  await waitHero(page, end, 'prévu le 31 mars = ' + eur(end));
  let f = await fin();
  check(f.includes('Objectifdefindemois') && f.includes(eur(P.objectif)) && f.includes('touslesmois'), 'objectif de fin de mois : ' + eur(P.objectif) + ', tous les mois (' + f.slice(0, 120) + ')');
  // Patch 5 : un seul montant, « Disponible d'ici le 31 », puis « Soit ~X € par jour » ; le calcul détaillé dans un ⓘ.
  check(f.includes('Disponibled\'icile31:' + eur0(possible)), 'disponible = ' + eur0(possible) + ' (prévu − objectif − URSSAF de mars due) (' + f.slice(0, 200) + ')');
  const left = 17; // du 15 au 31 mars
  check(f.includes('Soit~' + eur0(possible / left) + 'parjour.Tonobjectifetl\'URSSAFsontdéjàmisàpart.'), '« Soit ~' + eur0(possible / left) + ' par jour », objectif et URSSAF mis à part');
  check(!clean(await page.locator('#hero-sub').innerText()).includes('dépenser'), 'plus de « Tu peux encore dépenser » sous le gros chiffre');
  await page.click('#fin-card [data-act="info"][data-k="fin"]');
  await until(page, v => { const p = document.querySelector('#fin-card .cexp'); return !!p && p.textContent.replace(/[\s  ]/g, '').includes(v); }, 'URSSAFàpayer' + eur(P.dueMars), 'ⓘ Fin du mois : URSSAF de mars mise à part (' + eur(P.dueMars) + ')');
  await page.click('#fin-card .cexp');
  await until(page, () => !document.querySelector('#fin-card .cexp'), null, 'toucher la bulle la ferme');
  await page.screenshot({ path: join(OUT, tag + '-fin-du-mois.png'), fullPage: true });

  // 3. Objectif pour mars seulement, puis retiré : les autres mois et les autres réglages ne bougent pas
  const before = (await dump(page))[ST];
  await page.click('#fin-card [data-act="obj-open"]'); await panelOpen('Objectif de fin de mois');
  check(await page.inputValue('#obj-amount') === '300', 'objectif pré-rempli (300)');
  check(await page.locator('[data-act="obj-scope"][data-v="tous"][aria-pressed="true"]').count() === 1, '« Tous les mois » choisi d\'office');
  await page.click('[data-act="obj-scope"][data-v="mois"]');
  check((await page.locator('#obj-scope-hint').innerText()).includes('mars 2026'), 'explication : seulement mars 2026');
  await page.fill('#obj-amount', '200'); await page.click('[data-act="obj-save"]');
  await until(page, k => ((window.__PFLOW_DB__.dump()[k] || {}).objectifs || {})['2026-03'] === 200, ST, 'objectif de mars seulement enregistré (200 €)');
  db = await dump(page);
  check(db[ST].objectif === 300 && db[ST].objectifs['2026-04'] === 500, 'objectif de tous les mois et celui d\'avril inchangés');
  for (const k of Object.keys(before)) if (k !== 'objectifs') check(JSON.stringify(db[ST][k]) === JSON.stringify(before[k]), 'réglage « ' + k + ' » intact');
  await until(page, () => document.getElementById('fin-card').innerText.includes('seulement en mars'), null, 'carte : « seulement en mars »');
  f = await fin();
  check(f.includes('Disponibled\'icile31:' + eur0(possible + 100)), 'disponible avec 200 € d\'objectif = ' + eur0(possible + 100));
  await page.click('#fin-card [data-act="obj-open"]'); await panelOpen('Objectif de fin de mois');
  check(await page.locator('[data-act="obj-scope"][data-v="mois"][aria-pressed="true"]').count() === 1, 'mois réglé à part : « Seulement mars » choisi');
  await page.click('[data-act="obj-del"]');
  check(await page.locator('[data-act="obj-del"].armed').count() === 1, 'retirer l\'objectif : confirmation demandée');
  await page.click('[data-act="obj-del"]');
  await until(page, k => ((window.__PFLOW_DB__.dump()[k] || {}).objectifs || {})['2026-03'] === null, ST, 'objectif de mars retiré (mars reprend celui de tous les mois)');
  await until(page, () => document.getElementById('fin-card').innerText.includes('tous les mois'), null, 'carte : retour à l\'objectif de tous les mois');
  // Avril : son propre objectif, pas d'épargne proposée pour un mois à venir
  await page.click('[data-act="next-month"]');
  await until(page, () => document.getElementById('fin-card').innerText.includes('seulement en avril'), null, 'avril : objectif réglé à part');
  f = await fin();
  check(f.includes(eur(P.objectifAvril)) && !f.includes('Disponible'), 'avril : ' + eur(P.objectifAvril) + ', pas d\'épargne proposée pour un mois à venir');
  await page.click('[data-act="prev-month"]');
  await until(page, () => document.querySelector('#ctx h1').textContent.includes('Mars'), null, 'retour en mars');

  // 4. « Mettre de côté » : dépôt d'épargne pré-rempli avec le montant proposé
  await until(page, () => !!document.querySelector('#fin-card [data-act="ep-suggest"]'), null, 'bouton « Mettre de côté »');
  await page.click('#fin-card [data-act="ep-suggest"]');
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre d\'épargne ouverte');
  check(await page.inputValue('#f-amount') === String(possible), 'montant pré-rempli (' + possible + ')');
  check(await page.locator('#type-seg [data-type="epargne"][aria-pressed="true"]').count() === 1, 'type « Épargne » choisi');
  await page.click('#f-accounts [data-acc="Livret A"]'); await page.click('#f-save');
  await until(page, n => Object.values(window.__PFLOW_DB__.dump()).some(v => v.op === 'depot' && v.amount === n && v.date === '2026-03-15'), possible, 'dépôt d\'épargne enregistré');
  await until(page, () => document.getElementById('fin-card').innerText.replace(/[\s  ]/g, '').includes('Disponibled\'icile31:0€'), null, 'après le dépôt : plus rien de disponible');
  await waitHero(page, r2(end - possible), 'prévu le 31 après le dépôt');
  check(await page.locator('select, input[type="date"], input[type="month"], input[type="color"], datalist').count() === 0, 'aucune fenêtre native dans la page');
  noErr(errors, 'mars');
  await ctx.close();

  // 5. Payer l'URSSAF de mars avant l'échéance : montant réel dans la cascade, retiré du compte le jour du paiement
  ({ ctx, page, errors } = await open(cfg, fx.docs, { date: E._date }));
  await waitApp(page);
  await page.click('[data-act="urssaf-toggle"]');
  await page.click('#uc-info [data-act="up-open"]'); await panelOpen('URSSAF de mars');
  check(await page.inputValue('#up-amount') === '212', 'montant pré-rempli avec l\'estimation (212)');
  check((await page.locator('#up-date-txt').innerText()).includes('Aujourd'), 'date du paiement : aujourd\'hui (échéance pas encore passée)');
  await page.fill('#up-amount', '220'); await page.click('[data-act="up-save"]');
  await until(page, k => { const d = window.__PFLOW_DB__.dump()[k]; return !!d && d.payee === true && d.montant === 220 && d.date === '2026-03-15'; }, U + 'urssaf/2026-03', 'paiement de mars enregistré (220 € le 15 mars)');
  await urssafIs(220, 'cascade de mars : URSSAF = 220 € (réel)');
  await waitReste(page, r2(E.mars.reste - 8), 'reste de mars avec l\'URSSAF réelle');
  await waitHero(page, r2(E.mars.compte - 220), 'prévu le 31 : URSSAF de mars retirée le 15');
  // Plus d'URSSAF due à la fin du mois : seulement l'objectif. Bas du mois : 1 220 − 220 − 50 − 180 = 770 le 20.
  f = await fin();
  const p2 = Math.floor(Math.min(E.mars.compte - 220 - P.objectif, 770));
  check(f.includes('Disponibled\'icile31:' + eur0(p2)), 'disponible une fois l\'URSSAF payée = ' + eur0(p2) + ' (' + f.slice(0, 200) + ')');
  await page.click('#ctx .mtitle');
  await until(page, () => !!document.querySelector('.pop .cal-d[data-d="15"] .cdot.d-urs'), null, 'calendrier : URSSAF le jour du paiement (15)');
  await page.keyboard.press('Escape');
  noErr(errors, 'paiement de mars');
  await ctx.close();

  // 6. Après l'échéance : « URSSAF de mars payée ? » (Pas encore, puis Oui à la date de l'échéance)
  ({ ctx, page, errors } = await open(cfg, fx.docs, { date: '2026-05-02' }));
  await waitApp(page);
  await until(page, () => !document.getElementById('urs-ask').hidden && document.getElementById('urs-ask').innerText.includes('Celle de mars'), null, '« Celle de mars est payée ? » proposée après l\'échéance, dans le bloc URSSAF');
  check(clean(await page.locator('#urs-ask').innerText()).includes('Celledemars(' + eur(P.dueMars) + ')estpayée?'), 'question : « Celle de mars (' + eur(P.dueMars) + ') est payée ? »');
  await page.screenshot({ path: join(OUT, tag + '-urssaf-payee.png'), fullPage: true });
  await page.click('#urs-ask [data-act="up-later"]');
  await until(page, k => (window.__PFLOW_DB__.dump()[k] || {}).payee === false, U + 'urssaf/2026-03', '« Pas encore » rangé à part (urssaf/2026-03)');
  await until(page, () => document.getElementById('urs-ask').hidden, null, '« Pas encore » : question mise de côté jusqu\'à demain');
  check(await page.evaluate(() => localStorage.getItem('pf-urs-plus-tard')) === '2026-05-02|2026-03', 'rappel demain (propre à l\'appareil)');
  await page.evaluate(() => localStorage.removeItem('pf-urs-plus-tard'));
  await page.click('[data-act="next-month"]'); await page.click('[data-act="prev-month"]');
  await until(page, () => !document.getElementById('urs-ask').hidden, null, 'le lendemain : question reposée');
  await page.click('#urs-ask [data-act="up-open"]'); await panelOpen('URSSAF de mars');
  check(clean(await page.locator('#up-date-txt').innerText()).includes('30avril'), 'date proposée : l\'échéance (30 avril)');
  await page.click('[data-act="up-save"]');
  await until(page, k => { const d = window.__PFLOW_DB__.dump()[k]; return !!d && d.payee === true && d.montant === 212 && d.date === '2026-04-30'; }, U + 'urssaf/2026-03', '« Oui » : payée le 30 avril, 212 €');
  await until(page, () => document.getElementById('urs-ask').hidden, null, 'question retirée une fois payée');
  noErr(errors, 'après l\'échéance');
  await ctx.close();

  // 6 b. Deux URSSAF en attente (février et mars) : « Pas encore » sur chacune les met de côté toutes les deux pour
  // la journée ; un nouveau solde noté repose la question tout de suite.
  const two = JSON.parse(JSON.stringify(fx.docs));
  delete two[U + 'urssaf/2026-02'];
  ({ ctx, page, errors } = await open(cfg, two, { date: '2026-05-02' }));
  await waitApp(page);
  await until(page, () => !document.getElementById('urs-ask').hidden && document.getElementById('urs-ask').innerText.includes('Celle de février'), null, 'deux en attente : la plus ancienne d\'abord (février)');
  await page.click('#urs-ask [data-act="up-later"]');
  await until(page, () => !document.getElementById('urs-ask').hidden && document.getElementById('urs-ask').innerText.includes('Celle de mars'), null, 'puis mars');
  await page.click('#urs-ask [data-act="up-later"]');
  await until(page, () => document.getElementById('urs-ask').hidden, null, '« Pas encore » deux fois : plus rien à demander aujourd\'hui');
  check(await page.evaluate(() => localStorage.getItem('pf-urs-plus-tard')) === '2026-05-02|2026-02,2026-03', 'les deux périodes mises de côté pour la journée');
  await page.click('[data-act="next-month"]'); await page.click('[data-act="prev-month"]');
  await page.waitForTimeout(300);
  check(await page.locator('#urs-ask').isHidden(), 'février ne revient pas le même jour');
  await page.click('[data-act="solde-open"]');
  await until(page, () => !document.getElementById('panel-bg').hidden && document.getElementById('panel-title').textContent.includes('compte en banque'), null, 'fenêtre « Mon compte en banque » (6 b)');
  await page.fill('#sd-amount', '900');
  await page.click('[data-act="sd-save"]');
  await until(page, p => Object.entries(window.__PFLOW_DB__.dump()).some(([k, v]) => k.startsWith(p) && v.montant === 900 && v.date === '2026-05-02'), U + 'soldes/', 'nouveau solde enregistré (6 b)');
  await page.waitForTimeout(600);
  if (await page.locator('#panel-bg').isVisible()) { await page.click('#panel-close'); await page.waitForTimeout(400); }
  await until(page, () => !document.getElementById('urs-ask').hidden && document.getElementById('urs-ask').innerText.includes('Celle de février'), null, 'nouveau solde : « URSSAF payée ? » reposée tout de suite');
  noErr(errors, 'deux URSSAF en attente');
  await ctx.close();

  // 7. Déclaration trimestrielle : le montant réel du trimestre est réparti selon le chiffre d'affaires de chaque mois
  const q = JSON.parse(JSON.stringify(fx.docs));
  q[ST].periodicite = 'trimestrielle';
  delete q[U + 'urssaf/2026-02'];
  q[U + 'urssaf/2026-T1'] = { payee: true, date: '2026-04-20', montant: 300, createdAt: 1776643200000 };
  ({ ctx, page, errors } = await open(cfg, q, { date: E._date }));
  await waitApp(page);
  await urssafIs(200, 'trimestriel : mars = 200 € (1 000 sur 1 500 facturés)');
  check((await urssafNote()) === 'part du montant réel', 'trimestriel : mention « part du montant réel »');
  await page.click('[data-act="prev-month"]');
  await urssafIs(100, 'trimestriel : février = 100 € (500 sur 1 500 facturés)');
  noErr(errors, 'trimestriel');
  await ctx.close();
}

// ---------- patch 5 : écran Mois allégé, un seul bloc URSSAF, nouveau ⓘ, aide du taux (jeu 0.1.4) ----------
async function scenarioPatch5(cfg, fx, tag) {
  const E = fx.expect, P = E.patch4, U = 'users/uid-test/', ST = U + 'meta/settings';
  let { ctx, page, errors } = await open(cfg, fx.docs, { date: E._date });
  await waitApp(page);
  // 1. Gros chiffre en premier, puis les boutons, puis un seul bloc URSSAF ; une seule ligne sous le gros chiffre
  check(await page.evaluate(() => { const h = document.querySelector('#v-mois .hero'); return !h.previousElementSibling && h.nextElementSibling && h.nextElementSibling.id === 'urssaf-block'; }), 'rien au-dessus du gros chiffre ; bloc URSSAF juste sous les boutons d\'ajout');
  check(clean(await page.locator('#urssaf-line').innerText()) === 'URSSAFdemars' + eur(P.dueMars) + 'Àpayeravantle30avril', 'bloc URSSAF : « URSSAF de mars · ' + eur(P.dueMars) + ' · À payer avant le 30 avril » (' + clean(await page.locator('#urssaf-line').innerText()) + ')');
  check(await page.locator('#hero-sub > span').count() === 1, 'une seule ligne sous le gros chiffre');
  check(!clean(await page.locator('#hero-sub').innerText()).includes('parrapport'), 'la comparaison des dépenses n\'est plus sous le gros chiffre');
  check(await page.evaluate(() => { const c = document.querySelector('#legend .cmp'); return !c || c.closest('#legend > div').textContent.includes('Dépenses'); }), 'comparaison avec le mois d\'avant sous la ligne Dépenses du calcul');
  // Déplier le bloc : « Je l'ai payée » et le simulateur sont toujours dedans
  await page.click('#urssaf-line');
  await until(page, () => !document.getElementById('urssaf-card').hidden && !!document.querySelector('#uc-info [data-act="up-open"]') && !!document.getElementById('sim-btn'), null, 'bloc URSSAF déplié : « Je l\'ai payée » et « Simuler une facture »');
  await page.waitForFunction(() => document.getElementById('s-boot').hidden, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, tag + '-p5-mois.png') });
  await page.evaluate(() => document.getElementById('fin-card').scrollIntoView({ block: 'start' })); await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, tag + '-p5-fin.png') });
  await page.click('#urssaf-line');

  // 2. Nouveau ⓘ : pastille à l'accent, zone de toucher de 40 px, une seule bulle ouverte à la fois
  const box = await page.evaluate(() => {
    const b = document.querySelector('#legend [data-act="info"][data-k="urssaf"]');
    b.scrollIntoView({ block: 'center' }); // elementFromPoint ne voit que ce qui est à l'écran
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && e.closest('.cinfo') === b; };
    return { w: Math.round(r.width), bg: cs.backgroundColor, round: cs.borderRadius, edge: hit(r.right + 7, r.top + r.height / 2) && hit(r.left + r.width / 2, r.bottom + 7) };
  });
  check(box.w === 22 && box.round === '50%' && box.bg !== 'rgba(0, 0, 0, 0)', 'ⓘ : pastille ronde teintée (' + JSON.stringify(box) + ')');
  check(box.edge, 'ⓘ : se touche aussi juste à côté (zone de 40 px)');
  await page.click('#legend [data-act="info"][data-k="urssaf"]');
  await until(page, () => !!document.querySelector('#legend .cexp[data-k="urssaf"] .cexp-t') && document.querySelector('#legend [data-k="urssaf"].cinfo').getAttribute('aria-expanded') === 'true', null, 'ⓘ ouvert : bulle avec la ligne du temps, pastille pleine');
  await page.screenshot({ path: join(OUT, tag + '-p5-info.png') });
  await page.click('#legend [data-act="info"][data-k="net"]');
  await until(page, () => document.querySelectorAll('.cexp').length === 1 && !!document.querySelector('#legend .cexp[data-k="net"]'), null, 'ouvrir un autre ⓘ ferme le précédent');
  if (cfg.name === 'téléphone clair') {
    // Fermeture seule après le temps de lecture : 2,5 s + 0,35 s par mot, entre 6 et 12 s
    const words = await page.evaluate(() => document.querySelector('#legend .cexp').textContent.trim().split(/\s+/).length);
    const want = Math.min(12000, Math.max(6000, 2500 + 350 * words)), t0 = Date.now();
    await page.waitForFunction(() => !document.querySelector('#legend .cexp'), null, { timeout: 15000 }).catch(() => {});
    const dt = Date.now() - t0;
    check(dt > want - 1200 && dt < want + 1200, 'bulle fermée seule après ~' + (want / 1000) + ' s (' + words + ' mots, ' + (dt / 1000).toFixed(1) + ' s)');
    await page.click('#legend [data-act="info"][data-k="net"]');
    await until(page, () => !!document.querySelector('#legend .cexp'), null, 'retoucher le ⓘ : la bulle revient');
    // Patch 6 (point 0b) : retoucher le ⓘ ouvert ferme la bulle en fondu (elle reste un instant, puis disparaît).
    await page.waitForTimeout(450);
    await page.click('#legend [data-act="info"][data-k="net"]');
    check(await page.evaluate(() => !!document.querySelector('#legend .cexp[data-k="net"]') && document.querySelector('#legend [data-k="net"].cinfo').getAttribute('aria-expanded') === 'false'), 'retoucher le ⓘ : la bulle part en fondu');
    await until(page, () => !document.querySelector('#legend .cexp'), null, 'retoucher le ⓘ : bulle fermée après le fondu');
  }
  await page.click('[data-act="next-month"]');
  await until(page, () => !document.querySelector('.cexp'), null, 'changer de mois ferme la bulle');

  // 3. Mois à venir : sans rien à payer, pas de ligne « 0,00 € · URSSAF de … »
  await page.click('[data-act="next-month"]'); await page.click('[data-act="next-month"]');
  await until(page, () => document.querySelector('#ctx h1').textContent.includes('Juin'), null, 'juin affiché');
  const juin = await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#legend > div')).find(d => d.textContent.includes('URSSAF')); return { zero: !!r && /^0[,.]00/.test(r.querySelector('dd').textContent.trim()), hidden: document.getElementById('urssaf-block').hidden }; });
  check(juin.hidden === juin.zero, 'mois à venir : bloc URSSAF caché seulement s\'il est à 0 € (' + JSON.stringify(juin) + ')');
  await page.click('[data-act="today"]');

  // 4. Aide du taux URSSAF dans Réglages → Auto-entrepreneur, la même phrase qu'au premier démarrage
  await reglages(page, 'pro');
  check(clean(await page.locator('#sub-pro .rate-help').innerText()) === clean('Artisan (ex. électricien) : tape 21,98 %. Avec le versement libératoire : 23,68 %. Avec l\'ACRE la première année, le taux est réduit : regarde ton espace URSSAF.'), 'Réglages : aide du taux « tape 21,98 % »');
  noErr(errors, 'patch 5');
  await ctx.close();

  // 5. Sans objectif ni épargne suivie (comme les parents) : « Tu peux encore dépenser ~X € par jour » (gardé à la
  // demande du propriétaire), puis « Fixer un objectif » ; ni « Disponible » ni « Mettre de côté »
  const par = JSON.parse(JSON.stringify(fx.docs));
  delete par[ST].objectif; delete par[ST].objectifs; par[ST].epargne = false;
  ({ ctx, page, errors } = await open(cfg, par, { date: E._date }));
  await waitApp(page);
  await until(page, () => !document.getElementById('fin-card').hidden, null, 'carte Fin du mois affichée');
  const f = clean(await page.locator('#fin-card').innerText());
  check(/Tupeuxencoredépenser~[\d ]+€parjourjusqu'au31mars/.test(f) && f.includes('Fixerunobjectif') && !f.includes('Disponible') && !f.includes('Mettredecôté'), 'sans objectif ni épargne : « ~X € par jour » et « Fixer un objectif » (' + f + ')');
  await page.click('#fin-card [data-act="info"][data-k="fin"]');
  await until(page, () => { const p = document.querySelector('#fin-card .cexp'); return !!p && p.textContent.includes('Prévu le 31'); }, null, 'ⓘ : calcul du montant par jour');
  noErr(errors, 'sans objectif ni épargne');
  await ctx.close();
}

// ---------- patch 5, étape 2 : écran Année « Sur mon compte / Reste de l'année » (jeu 0.1.4 + un solde en janvier) ----------
async function scenarioPatch5Annee(cfg, fx, tag) {
  const E = fx.expect, U = 'users/uid-test/';
  const docs = JSON.parse(JSON.stringify(fx.docs));
  docs[U + 'soldes/test-janvier'] = { montant: 1800, date: '2026-01-05', createdAt: 1767600000000 };
  const { ctx, page, errors } = await open(cfg, docs, { date: E._date });
  await waitApp(page);
  await page.locator('[data-act="view"][data-view="annee"]:visible').click();
  await until(page, () => !document.getElementById('v-annee').hidden && !!document.querySelector('#v-annee table'), null, 'écran Année');
  // 1. Interrupteur affiché, « Sur mon compte » d'office (même réglage que l'écran Mois)
  check(await page.locator('#kpis [data-act="hero-mode"][data-v="compte"][aria-pressed="true"]').count() === 1, 'Année : interrupteur, « Sur mon compte » choisi');
  check(clean(await page.locator('#kpis .eyebrow').innerText()) === 'Prévusurtoncomptele31décembre', 'gros chiffre : « Prévu sur ton compte le 31 décembre »');
  check(clean(await page.locator('#kpis .hero-sub').innerText()).endsWith('depuistonsoldedu5janvier'), 'évolution depuis le premier solde de l\'année (' + clean(await page.locator('#kpis .hero-sub').innerText()) + ')');
  const col = await page.$$eval('#y-table tbody tr', trs => trs.map(tr => tr.lastElementChild.textContent.replace(/[\s  ]/g, '')));
  check(col.length === 12 && col.every(v => v !== '—'), 'colonne « Compte » remplie de janvier à décembre (' + col.join(' ') + ')');
  check(col[2] === clean(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(E.mars.compte))), 'mars : même solde que l\'écran Mois (' + col[2] + ')');
  check(clean(await page.locator('#y-table thead th:last-child').innerText()) === 'Comptefindumois', 'en-tête « Compte · fin du mois »');
  check(clean(await page.locator('#chart-title').textContent()) === 'Surtoncompteàlafindechaquemois', 'titre du graphique');
  // 2. Mêmes mots que l'écran Mois (point 23) : « Autres revenus », une seule case « Épargne »
  const minis = clean(await page.locator('#kpis .minis').innerText());
  check(minis.includes('Autresrevenus') && !minis.includes('SansURSSAF') && !minis.includes('Totalépargné') && !minis.includes('Misdecôté') && minis.includes('cetteannée'), 'cases : mêmes mots que l\'écran Mois (' + minis + ')');
  // 3. Seuils : une ligne, le détail dans un ⓘ (point 24)
  if (await page.locator('#y-meters-note').isVisible()) {
    check(clean(await page.locator('#y-meters-note').innerText()) === 'Au-delàde37500€,laTVAs\'appliquel\'annéesuivante.', 'seuils : une seule ligne');
    await page.click('#y-meters-note [data-act="info"]');
    await until(page, () => { const p = document.querySelector('#y-meters-note .cexp'); return !!p && p.textContent.includes('41 250'); }, null, 'ⓘ des seuils : le détail (41 250 €)');
  }
  await page.waitForFunction(() => document.getElementById('s-boot').hidden, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, tag + '-p5-annee-compte.png') });
  // 4. Bulle d'un mois : solde à la fin du mois et évolution sur le mois
  await page.click('#chart .bar-g[data-i="1"]');
  await until(page, () => { const b = document.getElementById('bubble'); return !b.hidden && b.textContent.includes('Sur ton compte') && b.textContent.includes('Sur le mois'); }, null, 'bulle : solde fin février et évolution du mois');
  await page.screenshot({ path: join(OUT, tag + '-p5-annee-bulle.png') });
  await page.click('#kpis .eyebrow');
  await until(page, () => document.getElementById('bubble').hidden, null, 'bulle refermée en touchant à côté');
  // 5. « Reste de l'année » : comme avant ; le choix suit dans l'écran Mois
  await page.evaluate(() => { window.__seg = document.getElementById('y-mode'); });
  await page.click('#kpis [data-act="hero-mode"][data-v="reste"]');
  await until(page, () => /l'année$/.test(document.querySelector('#kpis .eyebrow').textContent) && document.querySelector('#y-table thead th:last-child').textContent === 'Reste', null, '« Reste de l\'année » : gros chiffre et colonne Reste');
  // Retour sur l'APK 79 : l'interrupteur reste le même élément (transition et rebond du bouton, comme dans l'écran Mois)
  check(await page.evaluate(() => window.__seg === document.getElementById('y-mode') && window.__seg.isConnected), 'Année : l\'interrupteur n\'est pas redessiné (bascule douce)');
  check(await page.evaluate(() => localStorage.getItem('pf-vue-compte')) === '0', 'choix gardé sur l\'appareil (pf-vue-compte)');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, tag + '-p5-annee-reste.png') });
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  await until(page, () => document.getElementById('hero-label').textContent === 'Reste du mois', null, 'écran Mois : même choix (« Reste du mois »)');
  await page.click('#hero-mode [data-act="hero-mode"][data-v="compte"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, tag + '-p5-mois-large.png') });
  // Retour sur l'APK 80 : l'année suivante garde l'interrupteur et la prévision du compte (les opérations depuis le
  // dernier solde sont chargées), et le mois de janvier aussi ; la fin de décembre est la même dans Mois et Année.
  const dec = await page.evaluate(() => { const y = +document.querySelector('#ctx h1').textContent.slice(-4); return y; });
  await page.locator('[data-act="view"][data-view="annee"]:visible').click();
  await until(page, () => !document.getElementById('v-annee').hidden && !!document.getElementById('y-mode'), null, 'retour à l\'Année');
  await page.waitForTimeout(800); // le gros chiffre défile d'une vue à l'autre
  const end = clean(await page.locator('#kpis .big').textContent());
  await page.evaluate(() => { window.__segY = document.getElementById('y-mode'); });
  await page.click('[data-act="next-year"]');
  await until(page, y => document.querySelector('#ctx h1').textContent.trim() === String(y) && !!document.getElementById('y-mode') && /^Prévu\s+sur\s+ton\s+compte\s+le\s+31\s+décembre/.test(document.querySelector('#kpis .eyebrow').textContent), dec + 1, 'année suivante : interrupteur et « Prévu sur ton compte le 31 décembre »');
  // Patch 6 (point 0c) : changer d'année garde le même interrupteur (pas retiré puis recréé pendant le chargement).
  check(await page.evaluate(() => window.__segY === document.getElementById('y-mode') && window.__segY.isConnected), 'Année suivante : l\'interrupteur n\'est pas redessiné');
  await page.click('[data-act="prev-year"]');
  await until(page, y => document.querySelector('#ctx h1').textContent.trim() === String(y), dec, 'retour à l\'année du jeu');
  await page.locator('[data-act="view"][data-view="mois"]:visible').click();
  for (let i = 0; i < 14 && !(await page.locator('#ctx h1').textContent()).includes(String(dec + 1)); i++) { await page.click('[data-act="next-month"]'); await page.waitForTimeout(120); }
  await until(page, () => !document.getElementById('hero-mode').hidden && /^Prévu\s+sur\s+ton\s+compte\s+le\s+31\s+janvier/.test(document.getElementById('hero-label').textContent), null, 'janvier de l\'année suivante : prévision du compte gardée');
  await page.click('[data-act="prev-month"]');
  await until(page, v => /^Prévu\s+sur\s+ton\s+compte\s+le\s+31\s+décembre$/.test(document.getElementById('hero-label').textContent) && document.getElementById('hero-amount').textContent.replace(/\s/g, '').replace(/−/g, '-') === v, end, 'décembre : même montant dans Mois et dans Année (' + end + ')');
  // 6. Sans aucun solde : pas d'interrupteur dans l'Année
  noErr(errors, 'Année, sur mon compte');
  await ctx.close();
  const none = JSON.parse(JSON.stringify(fx.docs));
  for (const k of Object.keys(none)) if (k.startsWith(U + 'soldes/')) delete none[k];
  const o = await open(cfg, none, { date: E._date });
  await waitApp(o.page);
  await o.page.locator('[data-act="view"][data-view="annee"]:visible').click();
  await until(o.page, () => !document.getElementById('v-annee').hidden && !!document.querySelector('#v-annee table'), null, 'écran Année (sans solde)');
  check(await o.page.locator('#kpis .hero-mode').count() === 0 && /l'année$/.test(await o.page.locator('#kpis .eyebrow').textContent()), 'sans solde noté : pas d\'interrupteur, le reste de l\'année');
  noErr(o.errors, 'Année sans solde');
  await o.ctx.close();
}

// ---------- patch 5, étape 2 : mise en page selon la place (tablette, grand écran) : Mois, Fixes, Réglages ----------
async function scenarioPatch5Ecrans(cfg, fx, tag) {
  const E = fx.expect;
  const { ctx, page, errors } = await open(cfg, fx.docs, { date: E._date });
  await waitApp(page);
  await page.waitForFunction(() => document.getElementById('s-boot').hidden, null, { timeout: 5000 }).catch(() => {});
  const W = cfg.viewport.width, inner = await page.evaluate(() => { const m = document.querySelector('.main'), cs = getComputedStyle(m); return m.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); });
  // Mois : 1 colonne sous ~680 px de zone de contenu, 2 colonnes jusqu'à ~1300 px, 3 au-delà
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.month-grid')).gridTemplateColumns.split(' ').length);
  check(cols === (inner >= 1300 ? 3 : inner >= 680 ? 2 : 1), 'Mois : ' + cols + ' colonne(s) pour ' + Math.round(inner) + ' px de contenu');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, tag + '-p5-mois-cols.png') });
  // Fixes : charges | revenus côte à côte dès 1000 px
  await page.locator('[data-act="view"][data-view="fixes"]:visible').click();
  await until(page, () => !document.getElementById('v-fixes').hidden && !!document.querySelector('#fix-list .fx-c1'), null, 'Fixes : deux blocs');
  const fx2 = await page.evaluate(() => { const a = document.querySelector('.fx-c1').getBoundingClientRect(), b = document.querySelector('.fx-c2').getBoundingClientRect(); return b.left > a.right - 1; });
  check(fx2 === (inner >= 1000), 'Fixes : charges et revenus côte à côte seulement sur grand écran');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, tag + '-p5-fixes.png') });
  // Réglages : la liste reste à gauche et la page choisie à droite dès 1000 px ; sinon, sous-page comme avant
  await page.locator('[data-act="view"][data-view="reglages"]:visible').click();
  await until(page, () => !document.getElementById('v-reglages').hidden, null, 'Réglages');
  if (inner >= 1000) check(await page.locator('#sub-compte').isVisible() && await page.locator('#set-home').isVisible(), 'Réglages : la liste et « Mon compte » côte à côte');
  await page.click('#set-home [data-act="sub"][data-sub="apparence"]');
  await until(page, () => !document.getElementById('sub-apparence').hidden, null, 'Réglages → Apparence');
  check(await page.locator('#set-home').isVisible() === (inner >= 1000), 'la liste reste affichée seulement sur grand écran');
  if (inner >= 1000) check(await page.locator('#set-home [data-sub="apparence"][aria-current="page"]').count() === 1, 'page choisie surlignée dans la liste');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, tag + '-p5-reglages.png') });
  noErr(errors, 'mise en page');
  await ctx.close();
}

// ---------- lancement ----------
// Un scénario qui plante compte comme un échec, et les suivants continuent.
async function run(fn, name) {
  try { await fn(); } catch (e) { check(false, 'scénario ' + (name || '') + ' interrompu : ' + String(e.message).split('\n')[0]); if (process.env.DEBUG) console.log(String(e.message).split('\n').slice(0, 30).join('\n')); }
}
const fixtures = readdirSync(join(ROOT, 'tests/fixtures')).filter(f => f.endsWith('.json')).sort();
// Patch 6 : catégories, fixe chaque semaine, brouillon du +, didacticiel, rappel du solde, import (tableau et relevé).
async function scenarioPatch6(cfg, fx, tag) {
  const E = fx.expect, U = 'users/uid-test/';
  let { ctx, page, errors } = await open(cfg, fx.docs, { date: E._date });
  await waitApp(page);
  const closed = () => until(page, () => document.getElementById('sheet-bg').hidden, null, 'fenêtre fermée');
  // 1. Catégories devinées d'après le libellé (dépenses seulement), corrigées d'un toucher
  if (await page.locator('#lists [data-act="toggle-fixed"]').getAttribute('aria-expanded') !== 'true') { await page.click('#lists [data-act="toggle-fixed"]'); await page.waitForTimeout(600); }
  const cats = () => page.$$eval('#lists .row', rs => rs.map(r => [r.querySelector('.row-label').firstChild.textContent.trim(), (r.querySelector('.row-meta .cat') || {}).textContent || '']));
  let cs = await cats();
  const catOf = l => (cs.find(c => c[0] === l) || [])[1];
  check(catOf('Loyer') === 'Logement' && catOf('Courses') === 'Courses' && catOf('Assurance habitation') === 'Assurances', 'catégories devinées (' + JSON.stringify(cs) + ')');
  check(!catOf('Facture client A'), 'pas de catégorie pour un revenu');
  await page.locator('#lists .row[data-act="edit-entry"]', { hasText: 'Courses' }).first().click();
  await until(page, () => !document.getElementById('f-cat-field').hidden && document.getElementById('f-cat-txt').textContent === 'Courses · auto', null, 'fenêtre : catégorie « Courses · auto »');
  await page.click('#f-cat');
  await until(page, () => document.querySelectorAll('.pop [role="option"]').length >= 13, null, 'liste des catégories (maison)');
  await page.click('.pop [data-v="famille"]');
  await page.click('#f-save'); await closed();
  let db = await dump(page);
  check(db[U + 'categories/courses'] && db[U + 'categories/courses'].cat === 'famille', 'correction notée pour ce libellé (categories/courses)');
  await page.waitForTimeout(300); cs = await cats();
  check(catOf('Courses') === 'Famille', 'la liste montre la catégorie corrigée');

  // 2. Fixe chaque semaine : 3 dimanches à partir du 15 mars ; dataVersion 2 dans la même écriture
  const reste0 = await page.evaluate(() => document.getElementById('legend').innerText);
  await page.locator('[data-act="add"]:visible').first().click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre d\'ajout ouverte');
  check(await page.locator('#freq-seg button:visible').count() === 5, 'fréquence : 5 choix');
  const fb = await page.$$eval('#freq-seg button', bs => bs.filter(b => !b.hidden).map(b => b.scrollWidth <= b.clientWidth + 1));
  check(fb.every(Boolean), 'fréquence : chaque mot tient dans son bouton');
  await page.fill('#f-amount', '35'); await page.fill('#f-label', 'Plein hebdo');
  await page.click('#freq-seg [data-f="semaine"]');
  await until(page, () => /^Dimanche 15/.test(document.getElementById('f-when-txt').textContent) && /3 fois en mars/.test(document.getElementById('f-preview').textContent), null, 'semaine : dimanche 15, 3 fois en mars');
  check((await page.locator('#f-preview').innerText()).includes('105,00'), 'semaine : total du mois (105 €)');
  check((await page.locator('#f-cat-txt').innerText()).startsWith('Transport'), 'catégorie devinée en tapant : Transport');
  await page.click('#f-save'); await closed();
  db = await dump(page);
  const hb = Object.entries(db).filter(([k]) => k.startsWith(U + 'hebdo/'));
  check(hb.length === 1 && hb[0][1].wday === 7 && hb[0][1].start === E._date && hb[0][1].amount === 35 && hb[0][1].end === null, 'fixe hebdo enregistré (' + JSON.stringify(hb) + ')');
  check(db[U + 'meta/settings'].dataVersion === 2 && db[U + 'meta/settings'].pro === true, 'dataVersion 2 écrit, réglages gardés');
  await page.waitForTimeout(900);
  check(await hero(page) === eur(E.mars.compte - 105), 'prévu le 31 : 3 dimanches de moins (' + eur(E.mars.compte - 105) + ')');
  const row = page.locator('#lists .row[data-act="edit-heb"]').first();
  check((await row.innerText()).includes('chaque dimanche · 3 fois') && clean(await row.innerText()).includes(eur(105).replace('-', '')), 'Mois : « chaque dimanche · 3 fois », 105 €');
  check(reste0 !== await page.evaluate(() => document.getElementById('legend').innerText), 'le calcul du mois compte le fixe hebdo');
  await page.locator('[data-act="view"][data-view="fixes"]:visible').click();
  await until(page, () => /\/sem\./.test(document.getElementById('fix-list').innerText) && /chaque dimanche/.test(document.getElementById('fix-list').innerText), null, 'Fixes : « chaque dimanche », 35 €/sem.');
  // Modifier : la fenêtre garde la fréquence, la date de départ revient
  await page.locator('#fix-list .row[data-act="edit-heb"]').first().click();
  await until(page, () => !document.getElementById('sheet-bg').hidden && document.getElementById('f-freq-field').hidden && /^Dimanche 15/.test(document.getElementById('f-when-txt').textContent), null, 'modifier un fixe hebdo : départ repris, fréquence fixe');
  await page.click('#sheet-close'); await closed();

  // 3. Brouillon : toucher le fond garde la saisie ; on navigue, on y revient
  const w0 = await page.evaluate(() => window.__PFLOW_DB__.writes());
  await page.locator('[data-act="add"]:visible').first().click();
  await until(page, () => !document.getElementById('sheet-bg').hidden, null, 'fenêtre d\'ajout ouverte (brouillon)');
  await page.fill('#f-amount', '12'); await page.fill('#f-label', 'Café');
  await page.click('#sheet-bg', { position: { x: 6, y: 6 } });
  await until(page, () => !document.getElementById('draft').hidden && document.getElementById('draft-txt').textContent.replace(/\s/g, ' ') === 'Brouillon · 12,00 € · Café', null, 'brouillon en pilule : « Brouillon · 12,00 € · Café »');
  await page.locator('[data-act="view"][data-view="annee"]:visible').click();
  check(await page.locator('#draft').isVisible(), 'la pilule reste en changeant d\'écran');
  await page.click('#draft .draft-open');
  await until(page, () => !document.getElementById('sheet-bg').hidden && document.getElementById('f-amount').value === '12' && document.getElementById('f-label').value === 'Café', null, 'brouillon rouvert avec la saisie');
  await page.click('#sheet-close'); await closed();
  check(await page.locator('#draft').isHidden() && await page.evaluate(() => window.__PFLOW_DB__.writes()) === w0, 'brouillon abandonné avec ×, rien d\'enregistré');

  // 4. Année : par catégorie (l'URSSAF dans « Impôts et URSSAF »)
  await page.click('#y-top-mode [data-v="cat"]');
  await until(page, () => /Impôts et URSSAF/.test(document.getElementById('y-top').innerText) && /Logement/.test(document.getElementById('y-top').innerText), null, 'Année : dépenses par catégorie');
  await page.click('#y-top-mode [data-v="lib"]');

  // 5. Didacticiel depuis Réglages : étapes, Suivant, Échap
  await reglages(page, 'compte');
  await page.click('#sub-compte [data-act="tuto-start"]');
  await until(page, () => !document.getElementById('tuto').hidden && /^1 sur \d+$/.test(document.getElementById('tuto-n').textContent), null, 'didacticiel : étape 1');
  check(await page.evaluate(() => location.hash === '#mois' && !document.getElementById('v-mois').hidden), 'didacticiel : sur l\'écran Mois');
  const hole = await page.evaluate(() => { const h = document.querySelector('.tuto-hole').getBoundingClientRect(), t = document.querySelector('#v-mois .hero').getBoundingClientRect(); return h.left <= t.left + 1 && h.right >= t.right - 1 && h.top <= t.top + 1; });
  check(hole, 'didacticiel : le montant principal est mis en lumière');
  await page.click('[data-tuto="next"]');
  await until(page, () => /^2 sur/.test(document.getElementById('tuto-n').textContent), null, 'didacticiel : Suivant');
  await page.screenshot({ path: join(OUT, tag + '-p6-tuto.png') });
  if (cfg.isMobile) {
    // Retour sur l'APK 90 : vers une étape plus bas, la page défile en douceur (pas de saut) et la bulle revient ensuite.
    for (let k = 0; k < 8 && !/opérations/.test(await page.locator('#tuto-t').textContent()); k++) {
      const n0 = await page.locator('#tuto-n').textContent();
      const y0 = await page.evaluate(() => scrollY);
      await page.click('[data-tuto="next"]');
      await until(page, n => document.getElementById('tuto-n').textContent !== n, n0, 'didacticiel : étape suivante');
      const y1 = await page.evaluate(() => scrollY);
      // Téléphone (une colonne) seulement : sur tablette, les opérations sont en haut de la 2e colonne, la visite y remonte.
      if (cfg.viewport.width < 600 && /opérations/.test(await page.locator('#tuto-t').textContent())) check(y1 > y0, 'didacticiel : la visite descend vers les opérations (' + y0 + ' → ' + y1 + ')');
    }
    // Retour arrière puis Suivant : prise de mesures pendant la transition (position À L'ÉCRAN du contenu : depuis
    // l'APK 92, la page saute à sa place et le contenu revient en transform).
    const vis = () => page.evaluate(() => ({ top: Math.round(document.getElementById('v-mois').getBoundingClientRect().top), op: getComputedStyle(document.querySelector('.tuto-bub')).opacity }));
    await page.click('[data-tuto="prev"]'); await page.waitForTimeout(1100);
    const ya = (await vis()).top;
    await page.click('[data-tuto="next"]'); await page.waitForTimeout(140);
    const mid = await vis();
    await page.waitForTimeout(1000);
    const yb = (await vis()).top;
    check(yb !== ya && Math.min(ya, yb) < mid.top && mid.top < Math.max(ya, yb), 'didacticiel : défilement progressif à l\'écran (' + ya + ' → ' + mid.top + ' → ' + yb + ')');
    check(+mid.op < 0.5, 'didacticiel : la bulle part en fondu pendant le défilement (opacité ' + mid.op + ')');
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.tuto-bub')).opacity) === '1', 'didacticiel : la bulle revient');
  }
  await page.keyboard.press('Escape');
  await until(page, () => document.getElementById('tuto').hidden, null, 'didacticiel : Échap ferme');

  // 6. Rappel du solde : jours choisis dans Réglages (calendrier maison à cocher)
  await reglages(page, 'compte');
  check((await page.locator('#rappel-txt').innerText()) === 'Le dernier jour du mois', 'rappel : le dernier jour du mois d\'office');
  await page.click('#rappel-pick');
  await until(page, () => document.querySelectorAll('.pop-days .cal-d').length === 31, null, 'rappel : 31 jours à cocher');
  await page.click('.pop-days .cal-d[data-d="15"]'); await page.click('.pop-days [data-c="ok"]');
  await until(page, () => document.getElementById('rappel-txt').textContent === 'Le 15 et le dernier jour du mois', null, 'rappel : le 15 et le dernier jour');
  db = await dump(page);
  check(JSON.stringify(db[U + 'meta/settings'].rappelSolde) === '[15,31]', 'rappel : réglage synchronisé [15, 31]');

  // 7. Import d'un tableau CSV : doublon ignoré, sens choisi, annulable
  await reglages(page, 'donnees');
  const csv = 'Date;Quoi;Montant\n07/03/2026;Courses;85,40\n03/03/2026;Pharmacie;12,30\n06/03/2026;Cinéma;9,50\n';
  await page.setInputFiles('#imp-table', { name: 'mes-depenses.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await until(page, () => document.getElementById('panel-title').textContent === 'Importer un tableau' && /Ajouter 2 opérations/.test(document.querySelector('[data-act="imp-go"]').textContent), null, 'import tableau : 2 à ajouter (Courses déjà là)');
  check(/1 ligne déjà dans P-Flow/.test(await page.locator('#panel-body').innerText()), 'import tableau : doublon signalé');
  check(await page.locator('#imp-sign').isVisible(), 'import tableau : « Dépenses / Revenus » proposé (montants sans signe)');
  // Changer de sens garde le même .seg (sinon sa transition ne se joue pas) et met l'aperçu à jour.
  await page.evaluate(() => { document.getElementById('imp-sign').__garde = 1; });
  await page.click('#imp-sign [data-v="revenu"]');
  await until(page, () => /\+/.test(document.getElementById('imp-trest').textContent), null, 'import tableau : aperçu en revenus');
  check(await page.evaluate(() => document.getElementById('imp-sign').__garde === 1 && document.querySelector('#imp-sign [data-v="revenu"]').getAttribute('aria-pressed') === 'true'), 'import tableau : « Dépenses / Revenus » gardé (pas recréé)');
  await page.click('#imp-sign [data-v="depense"]');
  await page.click('[data-act="imp-go"]');
  await until(page, () => Object.keys(window.__PFLOW_DB__.dump()).filter(k => /\/entries\/imt/.test(k)).length === 2, null, 'import tableau : 2 opérations créées');
  db = await dump(page);
  const ph = Object.values(db).find(v => v.label === 'Pharmacie');
  check(ph && ph.type === 'depense' && ph.amount === 12.3 && ph.date === '2026-03-03' && ph.month === '2026-03', 'import tableau : opération normale (' + JSON.stringify(ph) + ')');
  // Le même fichier une seconde fois : rien de plus
  await page.setInputFiles('#imp-table', { name: 'mes-depenses.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await until(page, () => /Rien à ajouter/.test(document.querySelector('[data-act="imp-go"]').textContent), null, 'réimport du même fichier : rien à ajouter');
  await page.click('#panel-close');
  await until(page, () => !document.getElementById('imp-last').hidden, null, 'Réglages : « Annuler le dernier import »');
  await page.click('[data-act="imp-undo"]'); await page.click('[data-act="imp-undo"]');
  await until(page, () => Object.keys(window.__PFLOW_DB__.dump()).filter(k => /\/entries\/imt/.test(k)).length === 0, null, 'import annulé : opérations retirées');

  // 8. Relevé de banque (OFX) : loyer déjà compté par le fixe, Netflix repéré comme fixe, solde noté
  const tr = (d, a, n) => '<STMTTRN><TRNTYPE>' + (a < 0 ? 'DEBIT' : 'CREDIT') + '<DTPOSTED>' + d + '<TRNAMT>' + a + '<FITID>' + d + n.length + '<NAME>' + n + '</STMTTRN>';
  const ofx = 'OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>' + tr('20260108', -13.49, 'PRLV SEPA NETFLIX') + tr('20260208', -13.49, 'PRLV SEPA NETFLIX') + tr('20260308', -13.49, 'PRLV SEPA NETFLIX') +
    tr('20260305', -500, 'VIR LOYER MARS') + tr('20260312', -40.1, 'CB CARREFOUR 11/03') +
    tr('20260311', 50, 'VIR REMBOURSEMENT') + tr('20260210', -95.37, 'PRLV SEPA URSSAF') + '</BANKTRANLIST><LEDGERBAL><BALAMT>1000.00<DTASOF>20260314</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  // Avant l'import : URSSAF de janvier « pas encore payée » ; le Remboursement (e3) est « pas encore passé » dans le jeu de données.
  await page.evaluate(u => window.__PFLOW_DB__.set(u + 'urssaf/2026-01', { payee: false, createdAt: 1 }), U);
  await page.setInputFiles('#imp-bank', { name: 'releve.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(ofx, 'utf8') });
  await until(page, () => document.getElementById('panel-title').textContent === 'Importer un relevé' && /Fixes repérés/.test(document.getElementById('panel-body').textContent), null, 'relevé : fenêtre, fixes repérés');
  const pb = (await page.locator('#panel-body').textContent()).replace(/[\u00a0\u202f]/g, ' ');
  check(/Netflix/.test(pb) && /le 8 de chaque mois/.test(pb), 'relevé : Netflix, le 8 de chaque mois');
  check(/2 lignes déjà dans P-Flow/.test(pb), 'relevé : le loyer (fixe) et le Remboursement (opération) sont reconnus');
  check(/URSSAF de janvier 2026 : 95,37 €/.test(pb), 'relevé : URSSAF de janvier payée proposée');
  check(/1 000,00 € le 14 mars/.test(pb), 'relevé : solde proposé');
  check(await page.locator('#imp-rest .imp-line').count() === 1 && (await page.inputValue('#imp-rest .imp-lab')) === 'Carrefour', 'relevé : reste Carrefour, libellé nettoyé');
  await page.click('[data-act="imp-go"]');
  await until(page, () => Object.values(window.__PFLOW_DB__.dump()).some(v => v.label === 'Netflix' && v.start === '2026-01'), null, 'relevé : fixe Netflix créé (depuis janvier)');
  db = await dump(page);
  check(Object.values(db).filter(v => v.label === 'Carrefour' && v.amount === 40.1 && v.type === 'depense').length === 1, 'relevé : opération Carrefour créée');
  check(!Object.entries(db).some(([k, v]) => /\/entries\//.test(k) && /loyer|netflix/i.test(v.label || '')), 'relevé : ni loyer ni Netflix en double');
  check(Object.values(db).some(v => v.montant === 1000 && v.date === '2026-03-14'), 'relevé : solde du 14 mars noté');
  check(db[U + 'pointages/e3'] && db[U + 'pointages/e3'].passee === true, 'relevé : Remboursement retrouvé, passé au nouveau solde (pas compté deux fois)');
  check(db[U + 'urssaf/2026-01'] && db[U + 'urssaf/2026-01'].payee === true && db[U + 'urssaf/2026-01'].montant === 95.37, 'relevé : URSSAF de janvier payée');
  // Annuler : ce qui existait avant l'import est remis tel quel, le reste est retiré.
  await until(page, () => !document.getElementById('imp-last').hidden, null, 'relevé : « Annuler le dernier import »');
  await page.click('[data-act="imp-undo"]'); await page.click('[data-act="imp-undo"]');
  await until(page, () => !Object.values(window.__PFLOW_DB__.dump()).some(v => v.label === 'Netflix'), null, 'relevé annulé : fixe Netflix retiré');
  db = await dump(page);
  check(JSON.stringify(db[U + 'pointages/e3']) === JSON.stringify({ passee: false, createdAt: 1773216000000 }), 'relevé annulé : pointage du Remboursement remis (' + JSON.stringify(db[U + 'pointages/e3']) + ')');
  check(JSON.stringify(db[U + 'urssaf/2026-01']) === JSON.stringify({ payee: false, createdAt: 1 }), 'relevé annulé : URSSAF de janvier « pas encore » remise (' + JSON.stringify(db[U + 'urssaf/2026-01']) + ')');
  check(!Object.values(db).some(v => v.montant === 1000 && v.date === '2026-03-14') && db[U + 'soldes/s2'] && db[U + 'urssaf/2026-02'] && db[U + 'urssaf/2026-02'].champFutur, 'relevé annulé : solde importé retiré, le reste intact');
  noErr(errors, 'patch 6');
  await ctx.close();

  // 9. Rappel du solde : le dernier jour du mois, à l'ouverture ; « Plus tard »
  ({ ctx, page, errors } = await open(cfg, fx.docs, { date: '2026-03-31', ls: { 'pf-solde-plus-tard': '' } }));
  await waitApp(page);
  await until(page, () => !document.getElementById('panel-bg').hidden && document.getElementById('panel-title').textContent === 'Ton solde ?', null, 'rappel du solde le 31 : « Ton solde ? »');
  await page.click('[data-act="sd-later"]');
  await until(page, () => document.getElementById('panel-bg').hidden && localStorage.getItem('pf-solde-plus-tard') === '2026-03-31', null, 'rappel : « Plus tard » reposera demain');
  noErr(errors, 'rappel du solde');
  await ctx.close();
}

// --rapide (APK de test) : seulement le jeu de données le plus récent, sur téléphone clair et PC sombre, et un nouveau
// compte sur téléphone ; le test complet (tous les jeux, tous les écrans) reste obligatoire avant chaque publication.
const RAPIDE = process.argv.includes('--rapide');
const RAPIDE_CFG = ['téléphone clair', 'PC sombre'];
const onlyFx = process.env.FX ? new RegExp(process.env.FX) : null; // ex. FX=0.1.2
const onlyCfg = process.env.CFG ? new RegExp(process.env.CFG) : null; // ex. CFG=PC
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // ex. ONLY=Epargne pour un seul scénario
let current = '';
let curCfg = null; // une configuration peut se limiter à certains scénarios (`only`)
const go = async (name, fn) => { if ((!only || only.test(name)) && !(curCfg && curCfg.only && !curCfg.only.test(name))) { current = name; await run(fn, name); } };
for (const file of fixtures) {
  const fx = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures', file), 'utf8'));
  if (onlyFx && !onlyFx.test(file)) continue;
  const last = file === fixtures[fixtures.length - 1];
  if (RAPIDE && !last) continue;
  const oldFormat = !('epargne' in fx.docs['users/uid-test/meta/settings']);
  for (const cfg of CONFIGS.filter(c => (!onlyCfg || onlyCfg.test(c.name)) && (!RAPIDE || RAPIDE_CFG.includes(c.name)))) {
    const tag = file.replace('.json', '') + '-' + cfg.name.replace(/\s+/g, '-');
    const before = failures;
    curCfg = cfg;
    if (cfg.only && file !== fixtures[fixtures.length - 1]) continue;
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
    // Patch 3 : scénario écrit pour le jeu 0.1.3 (montants précis) ; patch 4 : jeu 0.1.4.
    if (file === 'v0.1.3-beta.json' && cfg.name !== 'tablette clair') await go('Patch3', () => scenarioPatch3(cfg, fx, tag));
    if (file === 'v0.1.4-beta.json' && cfg.name !== 'tablette clair') await go('Patch4', () => scenarioPatch4(cfg, fx, tag));
    if (file === 'v0.1.4-beta.json') await go('Patch5', () => scenarioPatch5(cfg, fx, tag));
    if (file === 'v0.1.4-beta.json') await go('Patch5Annee', () => scenarioPatch5Annee(cfg, fx, tag));
    if (file === 'v0.1.4-beta.json') await go('Patch5Ecrans', () => scenarioPatch5Ecrans(cfg, fx, tag));
    if (file === 'v0.1.4-beta.json') await go('Patch6', () => scenarioPatch6(cfg, fx, tag));
    if (last) {
      await go('Demandes', () => scenarioDemandes(cfg, fx, tag));
      await go('Nouveautes', () => scenarioNouveautes(cfg, fx, tag));
      await go('Apparence', () => scenarioApparence(cfg, fx, tag));
      await go('Navigation', () => scenarioNavigation(cfg, fx, tag));
    }
    console.log(failures === before ? '   ✓ ok' : '   ✗ ' + (failures - before) + ' échec(s)');
  }
}
curCfg = null;
for (const cfg of CONFIGS.filter(c => c.name === 'téléphone clair' || (!RAPIDE && c.name === 'PC clair'))) {
  const before = failures;
  console.log('▶ nouveau compte · ' + cfg.name);
  await go('NouveauCompte', () => scenarioNouveauCompte(cfg, 'nouveau-' + cfg.name.replace(/\s+/g, '-')));
  console.log(failures === before ? '   ✓ ok' : '   ✗ échec');
}

await browser.close();
server.close();
console.log('\n' + (failures ? '✗ ' + failures + ' échec(s) sur ' + checks + ' vérifications' : '✓ ' + checks + ' vérifications réussies'));
process.exit(failures ? 1 : 0);
