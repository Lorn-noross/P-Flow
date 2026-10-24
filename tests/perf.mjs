// Test de fluidité (patch 2) : processeur ralenti ×6 (vieux téléphone), mesure de chaque image pendant
// les animations (changement d'onglet, de mois, ouverture de la fenêtre d'ajout, sous-pages des Réglages,
// glissement du doigt). Utilise la construction de test (faux Firebase) : node tests/run.mjs la crée,
// ou ce script la crée lui-même sans --no-build.
// Lancement : CHROME_PATH=… node tests/perf.mjs [--no-build] [--rate=6]
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'tests/.dist');
const RATE = Number((process.argv.find(a => a.startsWith('--rate=')) || '--rate=6').split('=')[1]);
if (!process.argv.includes('--no-build')) execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build', '--config', 'tests/vite.config.js'], { cwd: ROOT, stdio: 'inherit' });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_APP = 'http://127.0.0.1:' + server.address().port + '/';
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: (process.env.CHROME_ARGS || '--no-sandbox').split(' ') } : {});
// Jeu de données le plus récent (patch 3 : avec un solde du compte, donc le calcul « Prévu sur ton compte » ;
// patch 4 : URSSAF payée et objectif de fin de mois, donc la carte « Fin du mois »).
const fx = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/v0.1.4-beta.json'), 'utf8'));
const notes = (await import('../vite.config.js')).latestNotes().version;

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris', colorScheme: 'dark' });
const page = await ctx.newPage();
await page.route(u => !u.href.startsWith(URL_APP), r => r.fulfill({ status: 200, body: '' }));
await page.clock.setFixedTime(new Date('2026-03-15T12:00:00+01:00'));
await page.addInitScript(([s, n]) => { window.__PFLOW_SEED__ = s; localStorage.setItem('pf-nouveautes', n); }, [Object.assign({ 'allowlist/test@example.invalid': { addedAt: 1 } }, fx.docs), notes]);
await page.goto(URL_APP);
await page.waitForFunction(() => document.getElementById('hero-amount').textContent !== '…');
await page.waitForTimeout(500);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });

// Enregistre la durée de chaque image (requestAnimationFrame) pendant `ms`.
async function measure(label, action, ms = 700) {
  await page.evaluate(() => { window.__f = []; let last = performance.now(); const tick = t => { window.__f.push(t - last); last = t; if (window.__rec) requestAnimationFrame(tick); }; window.__rec = true; requestAnimationFrame(tick); });
  await page.waitForTimeout(120);
  await page.evaluate(() => { window.__mark = window.__f.length; });
  await action();
  await page.waitForTimeout(ms);
  const f = await page.evaluate(() => { window.__rec = false; return window.__f.slice(window.__mark); });
  // Les premières images = le travail du toucher (calcul, mise en page et premier dessin du nouvel écran) :
  // l'animation ne démarre qu'ensuite, sans saut. On les sépare de l'animation elle-même.
  let k = 0; for (let i = 1; i < Math.min(5, f.length); i++) if (f[i] > f[k]) k = i;
  while (k + 1 < f.length && f[k + 1] > 40 && k < 6) k++;
  const first = [f.slice(0, k + 1).reduce((a, b) => a + b, 0)], rest = f.slice(k + 1);
  const worst = Math.max(0, ...rest), slow = rest.filter(d => d > 50).length; // > 50 ms au ralenti ×6 ≈ une image sautée sur un vrai téléphone
  console.log(label.padEnd(36) + ' affichage ' + Math.round(Math.max(...first)).toString().padStart(4) + ' ms · animation : pire image ' + worst.toFixed(1).padStart(5) + ' ms, ' + slow + ' image(s) > 50 ms sur ' + rest.length);
  return { worst, slow };
}
// Le « toucher » est envoyé depuis la page elle-même : on mesure l'appli, pas l'outil de test.
const tap = sel => () => page.evaluate(s => document.querySelector(s).click(), sel);
const tab = v => tap('.tabbar [data-view="' + v + '"]');
console.log('Processeur ralenti ×' + RATE + ' (téléphone 390 × 844, thème sombre)\n');
const R = [];
await measure('Repos, sans rien toucher (référence)', async () => {});
R.push(await measure('Onglet Mois → Fixes', tab('fixes')));
R.push(await measure('Onglet Fixes → Année', tab('annee')));
R.push(await measure('Onglet Année → Réglages', tab('reglages')));
R.push(await measure('Réglages → Apparence', tap('[data-act="sub"][data-sub="apparence"]')));
R.push(await measure('Apparence → Réglages', tap('[data-act="sub-back"]')));
R.push(await measure('Onglet Réglages → Mois', tab('mois')));
R.push(await measure('Mois suivant (flèche)', tap('[data-act="next-month"]')));
R.push(await measure('Mois précédent (flèche)', tap('[data-act="prev-month"]')));
R.push(await measure('Glisser le doigt (mois suivant)', () => page.evaluate(() => {
  const h = document.getElementById('v-mois'), x = 200, y = 400;
  const ev = (t, cx) => h.dispatchEvent(new PointerEvent(t, { pointerType: 'touch', pointerId: 3, isPrimary: true, clientX: cx, clientY: y, bubbles: true }));
  ev('pointerdown', x); for (let i = 1; i <= 8; i++) ev('pointermove', x - 20 * i); ev('pointerup', x - 160);
})));
// L'heure est figée pendant le test : après un glissement, l'appli ignore les touchers pendant 400 ms (Date.now) ;
// on avance l'horloge de 2 s, sinon tous les touchers suivants dans l'écran Mois seraient ignorés.
await page.clock.setFixedTime(new Date('2026-03-15T12:00:02+01:00'));
R.push(await measure('Ouvrir la fenêtre d\'ajout', tap('.tabbar .fab')));
R.push(await measure('Fermer la fenêtre d\'ajout', tap('#sheet-close')));
R.push(await measure('Déplier la carte URSSAF', tap('#urssaf-line')));
// Patch 3 : calendrier du mois (pilule du mois), bulle d'un jour, mois suivant dans le calendrier, calendrier de la date.
R.push(await measure('Ouvrir le calendrier du mois', tap('#ctx .mtitle')));
R.push(await measure('Toucher un jour (bulle)', tap('.pop .cal-d[data-d="20"]')));
R.push(await measure('Calendrier : mois suivant', tap('.pop [data-mc="next"]')));
R.push(await measure('Fermer le calendrier', () => page.keyboard.press('Escape')));
R.push(await measure('Ouvrir l\'explication ⓘ', tap('#legend [data-act="cas-info"][data-k="urssaf"]')));
// Patch 4 : objectif de fin de mois et paiement de l'URSSAF (fenêtres du bas).
R.push(await measure('Ouvrir l\'objectif de fin de mois', tap('#fin-card [data-act="obj-open"]')));
R.push(await measure('Fermer l\'objectif', tap('#panel-close')));
// Le calendrier a avancé d'un mois : retour au mois en cours (on ne paie pas l'URSSAF d'un mois à venir), carte URSSAF dépliée.
for (let i = 0; i < 6 && !(await page.evaluate(() => document.querySelector('#ctx h1').textContent.includes('Mars'))); i++) { await page.evaluate(() => document.querySelector('[data-act="prev-month"]').click()); await page.waitForTimeout(500); }
if (await page.evaluate(() => document.getElementById('urssaf-card').hidden)) { await page.evaluate(() => document.getElementById('urssaf-line').click()); await page.waitForTimeout(500); }
R.push(await measure('Ouvrir « URSSAF payée »', tap('#uc-info [data-act="up-open"]')));
R.push(await measure('Fermer « URSSAF payée »', tap('#panel-close')));
await page.evaluate(() => document.querySelector('.tabbar .fab').click()); await page.waitForTimeout(600);
R.push(await measure('Ouvrir le calendrier de la date', tap('#f-when')));
R.push(await measure('Calendrier de la date : mois suivant', tap('.pop [data-c="next"]')));
await page.keyboard.press('Escape'); await page.evaluate(() => document.getElementById('sheet-close').click()); await page.waitForTimeout(600);
// Défilement du contenu sous les pilules floutées du haut et la barre du bas (le flou est recalculé à chaque image).
const scrollTo = y => () => page.evaluate(y => { const y0 = scrollY, t0 = performance.now();
  const step = t => { const p = Math.min(1, (t - t0) / 600); scrollTo(0, y0 + (y - y0) * p); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }, y);
R.push(await measure('Défiler sous les pilules (bas)', scrollTo(900), 800));
R.push(await measure('Défiler sous les pilules (haut)', scrollTo(0), 800));
// Patch 4 : fond vivant (les reflets dérivent sous les pilules floutées). Pire cas : on le lance à la main et on fait
// défiler en même temps (l'appli, elle, le met en pause pendant un défilement).
const drift = () => page.evaluate(() => ['.glow .b1', '.glow .b2'].forEach((s, i) => document.querySelector(s).animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(3%,2%) scale(1.08)', opacity: .82, offset: .5 }, { transform: 'none', opacity: 1 }], { duration: 3000, delay: i * 200, easing: 'ease-in-out' })));
R.push(await measure('Fond vivant, au repos', drift, 1500));
await page.waitForTimeout(1800);
R.push(await measure('Fond vivant + défilement (pire cas)', async () => { await drift(); await scrollTo(900)(); }, 1200));
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);

await browser.close(); server.close();
const bad = R.filter(r => r.slow > 2);
console.log('\n' + (bad.length ? '⚠ ' + bad.length + ' animation(s) avec des saccades' : '✓ animations fluides (au plus 2 images > 50 ms par animation, processeur ralenti ×' + RATE + ')'));
process.exit(0);
