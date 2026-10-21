// Construction de l'appli pour les tests : Firebase est remplacé par des faux modules en mémoire.
// Sortie dans tests/.dist (ignoré par git). Ne sert jamais pour une publication.
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../vite.config.js';

const here = p => fileURLToPath(new URL(p, import.meta.url));

export default mergeConfig(base, defineConfig({
  root: here('..'),
  logLevel: 'warn',
  define: { __PFLOW_TEST__: 'true' },
  resolve: {
    alias: [
      { find: /^firebase\/app$/, replacement: here('./fakes/app.js') },
      { find: /^firebase\/auth$/, replacement: here('./fakes/auth.js') },
      { find: /^firebase\/firestore$/, replacement: here('./fakes/firestore.js') },
      { find: /^@capacitor-firebase\/authentication$/, replacement: here('./fakes/capacitor-firebase-auth.js') },
    ],
  },
  build: { outDir: here('./.dist'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
}));
