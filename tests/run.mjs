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

async function open(cfg, docs, opts = {}) {
  const ctx = await browser.newContext({ viewport: cfg.viewport, isMobile: !!cfg.isMobile, hasTouch: !!cfg.hasTouch, colorScheme: cfg.colorScheme, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(opts.date + 'T12:00:00+01:00'));
  await page.addInitScript(([seed, noUser]) => { window.__PFLOW_SEED__ = seed; window.__PFLOW_NO_USER__ = noUser; }, [docs, !!opts.noUser]);
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
