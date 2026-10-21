// Google Drive : sauvegardes de P-Flow dans un dossier « P-Flow Sauvegardes ».
// Accès limité aux fichiers créés par P-Flow (drive.file) : P-Flow ne voit rien d'autre du Drive.
// Android : jeton via le module natif PFlowNative (sans fenêtre si l'accès est déjà accordé).
// Navigateur : Google Identity Services, qui ouvre une fenêtre Google (il faut un geste de l'utilisateur).
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'P-Flow Sauvegardes';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GIS_URL = 'https://accounts.google.com/gsi/client';
export const KEEP = 12; // sauvegardes gardées ; les plus anciennes vont à la corbeille du Drive
export const WEB_CLIENT_ID = '59632894514-0ohnt3579r5f9mivejeqsl1d3le42ta1.apps.googleusercontent.com';

export class DriveError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

let token = null, tokenExp = 0;
let gisClient = null, gisLoading = null, gisFailAt = 0, waiting = null;

/* ---------- jeton d'accès ---------- */

// Navigateur : charge la bibliothèque Google à l'avance, pour que le clic ouvre la fenêtre tout de suite.
export function prepareWeb(hint) {
  if (gisClient || typeof window === 'undefined') return Promise.resolve();
  if (!gisLoading && Date.now() - gisFailAt < 30000) return Promise.reject(new DriveError('Google ne répond pas. Vérifie ta connexion internet.', 'NETWORK'));
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) { resolve(); return; }
      const s = document.createElement('script');
      s.src = GIS_URL; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); gisLoading = null; gisFailAt = Date.now(); reject(new DriveError('Google ne répond pas. Vérifie ta connexion internet.', 'NETWORK')); };
      document.head.appendChild(s);
    }).then(() => {
      gisClient = window.google.accounts.oauth2.initTokenClient({
        client_id: WEB_CLIENT_ID,
        scope: SCOPE,
        prompt: '',
        login_hint: hint || undefined,
        callback: resp => {
          const w = waiting; waiting = null;
          if (!w) return;
          if (!resp || resp.error) { w.reject(new DriveError('Google n\'a pas donné l\'accès à Drive.', 'AUTH_ERROR')); return; }
          if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) { w.reject(new DriveError('L\'accès à Google Drive n\'a pas été accordé.', 'NO_TOKEN')); return; }
          token = resp.access_token;
          tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          w.resolve(token);
        },
        error_callback: err => {
          const w = waiting; waiting = null;
          if (!w) return;
          const t = err && err.type;
          w.reject(t === 'popup_failed_to_open'
            ? new DriveError('La fenêtre Google a été bloquée. Autorise les fenêtres pop-up pour ce site, puis réessaie.', 'POPUP')
            : new DriveError('Connexion à Google Drive annulée.', 'CANCELED'));
        },
      });
    });
  }
  return gisLoading;
}

// Donne un jeton d'accès valable. ATTENTION navigateur : à appeler directement dans le clic
// (aucun « await » avant), sinon la fenêtre Google est bloquée.
/* global __PFLOW_TEST__ */
export function getToken({ native, plugin, interactive, hint }) {
  if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
  // Tests uniquement : jeton fictif (les appels à Drive sont simulés par le test).
  if (typeof __PFLOW_TEST__ !== 'undefined' && window.__PFLOW_DRIVE_TOKEN__) {
    if (!interactive && window.__PFLOW_DRIVE_TOKEN__ === 'consent') return Promise.reject(new DriveError('Il faut autoriser Google Drive.', 'NEEDS_CONSENT'));
    token = window.__PFLOW_DRIVE_TOKEN__; tokenExp = Date.now() + 3600000;
    return Promise.resolve(token);
  }
  if (native) {
    return plugin.authorizeDrive({ interactive: !!interactive }).then(r => {
      token = r.accessToken; tokenExp = Date.now() + 50 * 60000;
      return token;
    }, e => {
      const code = (e && e.code) || 'AUTH_ERROR';
      throw new DriveError((e && e.message) || 'Google Drive est indisponible pour le moment.', code);
    });
  }
  if (!interactive) return Promise.reject(new DriveError('Il faut autoriser Google Drive.', 'NEEDS_CONSENT'));
  if (!gisClient) {
    prepareWeb(hint).catch(() => {});
    return Promise.reject(new DriveError('Google se prépare. Réessaie dans quelques secondes.', 'NOT_READY'));
  }
  return new Promise((resolve, reject) => {
    if (waiting) waiting.reject(new DriveError('Connexion à Google Drive annulée.', 'CANCELED'));
    waiting = { resolve, reject };
    gisClient.requestAccessToken();
  });
}

export function forgetToken() { token = null; tokenExp = 0; }

/* ---------- appels à l'API Drive ---------- */

async function api(method, url, opts = {}) {
  let r;
  try {
    r = await fetch(url, { method, headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {}), body: opts.body });
  } catch (e) {
    throw new DriveError('Pas de connexion internet.', 'NETWORK');
  }
  if (r.status === 401) { forgetToken(); throw new DriveError('L\'autorisation Google a expiré : réessaie.', 'AUTH_EXPIRED'); }
  if (!r.ok) {
    let m = '';
    try { m = (await r.json()).error.message; } catch (e) { /* réponse sans détail */ }
    throw new DriveError('Google Drive a refusé la demande (' + r.status + (m ? ' : ' + m : '') + ').', 'HTTP');
  }
  return opts.text ? r.text() : r.json();
}
const q = s => encodeURIComponent(s);

async function folderId() {
  const found = await api('GET', API + '/files?spaces=drive&pageSize=10&fields=' + q('files(id,name)') +
    '&q=' + q("name = '" + FOLDER + "' and mimeType = '" + FOLDER_MIME + "' and trashed = false"));
  if (found.files && found.files.length) return found.files[0].id;
  const created = await api('POST', API + '/files?fields=id', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_MIME }),
  });
  return created.id;
}

async function listIn(fid) {
  const r = await api('GET', API + '/files?pageSize=100&orderBy=' + q('createdTime desc') + '&fields=' + q('files(id,name,createdTime,size)') +
    '&q=' + q("'" + fid + "' in parents and trashed = false"));
  return r.files || [];
}

// Liste des sauvegardes, de la plus récente à la plus ancienne.
export async function list() { return listIn(await folderId()); }

// Envoie une sauvegarde, puis met à la corbeille celles au-delà des KEEP plus récentes.
export async function upload(name, text) {
  const fid = await folderId();
  const b = 'pflow' + Math.random().toString(36).slice(2);
  const meta = { name, parents: [fid], mimeType: 'application/json', appProperties: { pflow: '1' } };
  const body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
    '\r\n--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + text + '\r\n--' + b + '--';
  const f = await api('POST', UPLOAD + '/files?uploadType=multipart&fields=' + q('id,name,createdTime,size'), {
    headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body,
  });
  try {
    const old = (await listIn(fid)).slice(KEEP);
    for (const o of old) {
      await api('PATCH', API + '/files/' + q(o.id) + '?fields=id', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    }
  } catch (e) { /* le ménage se refera à la prochaine sauvegarde */ }
  return f;
}

export async function download(id) { return api('GET', API + '/files/' + q(id) + '?alt=media', { text: true }); }
