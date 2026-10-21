import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const build = process.env.GITHUB_RUN_NUMBER || '0';

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkg.version),
    __APP_BUILD__: JSON.stringify(build),
    __PAGES_URL__: JSON.stringify('https://lorn-noross.github.io/P-Flow/'),
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
});
