import { defineConfig } from 'vite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const build = process.env.GITHUB_RUN_NUMBER || '0';

// Nouveautés affichées dans l'appli après une mise à jour (notes-de-version/<version>.md).
// - Publication (APP_VERSION sans « -test ») : les notes de la version publiée.
// - APK de test et tests locaux : les notes les plus récentes (brouillon de la prochaine version).
const NOTES_DIR = new URL('./notes-de-version/', import.meta.url);
const verNum = v => v.split('-')[0].split('.').map(Number);
const cmpVer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
export function latestNotes() {
  const env = process.env.APP_VERSION || '';
  let v = null;
  if (env && !/-test\d*$/.test(env) && existsSync(new URL(env + '.md', NOTES_DIR))) v = env;
  if (!v) {
    for (const f of readdirSync(NOTES_DIR)) {
      const m = f.match(/^(\d+\.\d+\.\d+(?:-[a-z]+)?)\.md$/);
      if (m && (!v || cmpVer(m[1], v) > 0)) v = m[1];
    }
  }
  return v ? { version: v, text: readFileSync(new URL(v + '.md', NOTES_DIR), 'utf8') } : { version: '', text: '' };
}
const notes = latestNotes();

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkg.version),
    __APP_BUILD__: JSON.stringify(build),
    __PAGES_URL__: JSON.stringify('https://lorn-noross.github.io/P-Flow/'),
    __NOTES__: JSON.stringify(notes.text),
    __NOTES_VERSION__: JSON.stringify(notes.version),
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
});
