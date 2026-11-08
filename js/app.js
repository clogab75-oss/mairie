import { sb, state, can, loadSession, loadSettings, markNotifsRead } from './state.js';
import { $, $$, esc, toast, initials, ROLE_LABEL, ROLE_SERVICE, fmtDT, errMsg } from './lib.js';
import { brandURL } from './branding.js';

const UUID = '([0-9a-fA-F-]{36})';
const ROUTES = [
  { re: /^\/$/, page: 'dashboard', nav: 'home', ok: () => true },
  { re: /^\/annonces$/, page: 'announcements', nav: 'annonces', ok: () => true },
  { re: /^\/mandats$/, page: 'mandates', nav: 'mandats', ok: () => can.viewMandates() },
  { re: /^\/mandats\/nouveau$/, page: 'mandate-new', nav: 'mandats', ok: () => can.createMandate() },
  { re: new RegExp(`^/mandats/${UUID}$`), page: 'mandate-detail', nav: 'mandats', ok: () => can.viewMandates() },
  { re: new RegExp(`^/mandats/${UUID}/conversation$`), page: 'mandate-detail', nav: 'conversations', tab: 'conversation', ok: () => can.conversations() },
  { re: /^\/conversations$/, page: 'conversations', nav: 'conversations', ok: () => can.conversations() },
  { re: /^\/police$/, page: 'service', service: 'police', nav: 'police', ok: () => can.viewMandates() },
  { re: /^\/gendarmerie$/, page: 'service', service: 'gendarmerie', nav: 'gendarmerie', ok: () => can.viewMandates() },
  { re: /^\/documents$/, page: 'documents', nav: 'documents', ok: () => can.documents() },
  { re: /^\/historique$/, page: 'history', nav: 'historique', ok: () => can.history() },
  { re: /^\/utilisateurs$/, page: 'users', nav: 'utilisateurs', ok: () => can.mayor() },
  { re: /^\/parametres$/, page: 'settings', nav: 'parametres', ok: () => can.mayor() },
];

const PUBLIC = [
  { re: /^\/$/, all: false, nav: 'home' },
  { re: /^\/annonces$/, all: true, nav: 'annonces' },
];

let cleanup = null;
let renderId = 0;
let notifChan = null;
let mode = 'boot';
let pendingTarget = '';
let pendingNotice = '';

const root = () => $('#app');

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return {
    path: path.replace(/\/+$/, '') || '/',
    query: Object.fromEntries(new URLSearchParams(qs || '')),
  };
}

export const go = (hash) => { location.hash = hash; };

async function showLogin(notice = '') {
  teardown();
  mode = 'login';
  const { default: renderLogin } = await import('./pages/login.js');
  renderLogin(root(), { notice, onDone: afterLogin });
}

function teardown() {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  if (notifChan) { sb.removeChannel(notifChan); notifChan = null; }
  renderId++;
}

async function logout() {
  teardown();
  await sb.auth.signOut();
  state.user = null; state.profile = null; state.notifs = [];
  mode = 'public';
  root().innerHTML = '';
  if (location.hash === '#/' || !location.hash) route(); else location.hash = '#/';
}

async function afterLogin() {
  let res;
  try { res = await loadSession(); } catch (e) { return showLogin(`Erreur de chargement : ${errMsg(e)}`); }
  if (res === true) return enterApp();
  if (res === 'missing' || res === 'inactive') {
    await sb.auth.signOut();
    return showLogin(res === 'inactive'
      ? 'Votre compte est désactivé. Contactez le maire.'
      : 'Profil introuvable. Contactez le maire.');
  }
  return showLogin();
}

function enterApp() {
  teardown();
  mode = 'app';
  drawShell();
  subscribeNotifs();
  const target = pendingTarget || '#/';
  pendingTarget = '';
  if (location.hash !== target) location.hash = target;
  routeApp();
}

async function boot() {
  try { await loadSettings(); } catch (e) { console.error(e); }
  let res = false;
  try { res = await loadSession(); } catch (e) { console.error(e); }
  if (res === true) { mode = 'app'; drawShell(); subscribeNotifs(); routeApp(); return; }
  if (res === 'missing' || res === 'inactive') {
    await sb.auth.signOut();
    pendingNotice = res === 'inactive' ? 'Votre compte est désactivé. Contactez le maire.' : 'Profil introuvable. Contactez le maire.';
    mode = 'public';
    location.hash = '#/connexion';
  }
  mode = mode === 'boot' ? 'public' : mode;
  route();
}

function route() {
  if (mode === 'app') return routeApp();
  if (mode === 'boot') return undefined;
  const { path } = parseHash();
  if (path === '/connexion') {
    if (mode !== 'login') { const n = pendingNotice; pendingNotice = ''; showLogin(n); }
    return undefined;
  }
  const m = PUBLIC.find((r) => r.re.test(path));
  if (!m) {
    pendingTarget = location.hash;
    pendingNotice = 'Connectez-vous pour accéder à cet espace.';
    go('#/connexion');
    return undefined;
  }
  return routePublic(m);
}

function drawPublicShell() {
  const s = state.settings;
  root().innerHTML = `
  <div class="pub">
    <header class="pub-nav">
      <a class="pub-brand" href="#/"><img src="${esc(brandURL('logo'))}" alt=""><span>${esc(s.mairie_name)}</span></a>
      <nav class="pub-links" id="pubLinks">
        <a href="#/" data-nav="home">Accueil</a>
        <a href="#/annonces" data-nav="annonces">Annonces citoyennes</a>
      </nav>
      <a class="btn gold" href="#/connexion">Espace agents</a>
    </header>
    <main id="pubView"></main>
    <footer class="pub-foot">
      <b>${esc(s.mairie_name)}</b>
      <div>${esc(s.pdf_extra || 'Nova Life RP')}</div>
      <div class="small" style="margin-top:8px"><a href="#/connexion">Accès réservé aux agents</a></div>
    </footer>
  </div>`;
}

async function routePublic(m) {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const id = ++renderId;
  mode = 'public';
  if (!$('#pubView')) drawPublicShell();
  $$('#pubLinks a').forEach((a) => a.classList.toggle('active', a.dataset.nav === m.nav));
  const view = $('#pubView');
  view.innerHTML = '<div class="loading">Chargement…</div>';
  window.scrollTo(0, 0);
  try {
    const mod = await import('./pages/landing.js');
    if (id !== renderId) return;
    await mod.default(view, { all: m.all });
  } catch (e) {
    console.error(e);
    if (id === renderId) view.innerHTML = `<div class="section"><div class="card error"><h2>Erreur</h2><p>${esc(errMsg(e))}</p></div></div>`;
  }
}

function drawShell() {
  const p = state.profile;
  const s = state.settings;
  root().innerHTML = `
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <img src="${esc(brandURL('logo'))}" alt="Logo">
        <div><b>${esc(s.mairie_name)}</b><small>Portail administratif</small></div>
      </div>
      <nav class="nav" id="nav"></nav>
      <div class="side-user">
        <div class="avatar">${esc(initials(p.prenom, p.nom))}</div>
        <div class="who"><b>${esc(p.prenom)} ${esc(p.nom)}</b><small>${esc(ROLE_LABEL[p.role] || '')} · ${esc(ROLE_SERVICE[p.role] || '')}</small></div>
        <button class="icon-btn" id="logoutBtn" title="Se déconnecter" aria-label="Se déconnecter">🚪</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn" id="menuBtn" aria-label="Menu">☰</button>
        <div class="search ${can.viewMandates() ? '' : 'hide'}">
          <input id="topSearch" type="search" placeholder="Rechercher : n° de mandat, nom, plaque, terrain, agent…" aria-label="Recherche globale">
        </div>
        <div style="flex:1"></div>
        <div class="bell" style="position:relative">
          <button class="icon-btn" id="bellBtn" aria-label="Notifications">🔔</button>
          <span class="dot hide" id="bellDot">0</span>
          <div class="notif-panel hide" id="notifPanel"></div>
        </div>
      </header>
      <main id="view"></main>
    </div>
  </div>`;

  $('#logoutBtn').onclick = logout;
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#topSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = e.target.value.trim();
    go(v ? `#/mandats?q=${encodeURIComponent(v)}` : '#/mandats');
  });
  $('#bellBtn').onclick = (e) => { e.stopPropagation(); toggleNotifPanel(); };
  renderBell();
}

function navItems() {
  const items = [
    { id: 'home', href: '#/', ico: '🏠', label: 'Accueil' },
    { id: 'annonces', href: '#/annonces', ico: '📢', label: 'Annonces citoyennes', count: state.notifs.filter((n) => !n.is_read && n.type === 'announcement').length },
  ];
  const dossiers = [];
  if (can.viewMandates()) dossiers.push({ id: 'mandats', href: '#/mandats', ico: '📁', label: 'Mandats' });
  if (can.conversations()) dossiers.push({ id: 'conversations', href: '#/conversations', ico: '💬', label: 'Conversations', count: unreadMessages() });
  if (can.viewMandates()) {
    dossiers.push({ id: 'police', href: '#/police', ico: '👮', label: 'Police' });
    dossiers.push({ id: 'gendarmerie', href: '#/gendarmerie', ico: '🪖', label: 'Gendarmerie' });
  }
  const archives = [];
  if (can.documents()) archives.push({ id: 'documents', href: '#/documents', ico: '📄', label: 'Documents' });
  if (can.history()) archives.push({ id: 'historique', href: '#/historique', ico: '📜', label: 'Historique' });
  const admin = [];
  if (can.mayor()) {
    admin.push({ id: 'utilisateurs', href: '#/utilisateurs', ico: '👥', label: 'Utilisateurs' });
    admin.push({ id: 'parametres', href: '#/parametres', ico: '⚙️', label: 'Paramètres' });
  }
  return { items, groups: [['Dossiers', dossiers], ['Archives', archives], ['Administration', admin]] };
}

const unreadMessages = () => state.notifs.filter((n) => !n.is_read && n.type === 'message').length;

function renderNav(active) {
  const nav = $('#nav');
  if (!nav) return;
  const { items, groups } = navItems();
  const link = (i) => `<a href="${i.href}" class="${i.id === active ? 'active' : ''}">
      <span>${i.ico}</span><span>${esc(i.label)}</span>${i.count ? `<span class="count">${i.count}</span>` : ''}</a>`;
  nav.innerHTML = items.map(link).join('')
    + groups.filter(([, l]) => l.length).map(([t, l]) => `<div class="sep">${esc(t)}</div>${l.map(link).join('')}`).join('');
  $$('a', nav).forEach((a) => a.addEventListener('click', () => $('#sidebar').classList.remove('open')));
}

async function routeApp() {
  if (mode !== 'app' || !state.profile) return;
  const id = ++renderId;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }

  const { path, query } = parseHash();
  let match = null; let params = [];
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) { match = r; params = m.slice(1); break; }
  }
  const view = $('#view');
  if (!view) return;

  if (!match) {
    view.innerHTML = `<div class="card empty">Page introuvable. <a href="#/">Retour à l'accueil</a></div>`;
    renderNav('');
    return;
  }
  if (!match.ok()) {
    view.innerHTML = `<div class="card error"><h2>Accès refusé</h2><p class="muted">Votre rôle ne permet pas d'ouvrir cette page.</p><a class="btn" href="#/">Retour à l'accueil</a></div>`;
    renderNav('');
    return;
  }

  renderNav(match.nav);
  view.innerHTML = `<div class="loading">Chargement…</div>`;
  window.scrollTo(0, 0);

  try {
    const mod = await import(`./pages/${match.page}.js`);
    if (id !== renderId) return;
    const ctx = { view, params, query, tab: match.tab || null, service: match.service || null, go, refreshNav: () => renderBell() };
    const out = await mod.default(view, ctx);
    if (id !== renderId) { if (typeof out === 'function') out(); return; }
    if (typeof out === 'function') cleanup = out;
  } catch (e) {
    console.error(e);
    if (id === renderId) view.innerHTML = `<div class="card error"><h2>Erreur</h2><p>${esc(errMsg(e))}</p></div>`;
  }
}

function renderBell() {
  const n = state.notifs.filter((x) => !x.is_read).length;
  const dot = $('#bellDot');
  if (dot) { dot.textContent = n > 99 ? '99+' : String(n); dot.classList.toggle('hide', n === 0); }
  const active = $('#nav a.active');
  if (active && $('#nav')) renderNav(ROUTES.find((r) => parseHash().path.match(r.re))?.nav || '');
  if (!$('#notifPanel')?.classList.contains('hide')) fillNotifPanel();
}

function notifTarget(n) {
  if (n.type === 'announcement') return '#/annonces';
  if (!n.mandate_id) return '#/';
  if (n.type === 'message' && can.conversations()) return `#/mandats/${n.mandate_id}/conversation`;
  return `#/mandats/${n.mandate_id}`;
}

function fillNotifPanel() {
  const panel = $('#notifPanel');
  const list = state.notifs;
  panel.innerHTML = `
    <div class="head"><b>Notifications</b>${list.some((n) => !n.is_read) ? '<button class="btn sm ghost" id="readAll">Tout marquer comme lu</button>' : ''}</div>
    ${list.length ? list.map((n) => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${esc(n.id)}">
        <b>${esc(n.title)}</b><span>${esc(n.body || '')}</span><br><span class="small">${esc(fmtDT(n.created_at))}</span>
      </div>`).join('') : '<div class="empty">Aucune notification.</div>'}`;
  $('#readAll', panel)?.addEventListener('click', async () => { await markNotifsRead(); renderBell(); });
  $$('.notif-item', panel).forEach((el) => {
    el.onclick = async () => {
      const n = state.notifs.find((x) => x.id === el.dataset.id);
      if (!n) return;
      if (!n.is_read) { await markNotifsRead({ id: n.id }); renderBell(); }
      panel.classList.add('hide');
      go(notifTarget(n));
    };
  });
}

function toggleNotifPanel() {
  const panel = $('#notifPanel');
  const open = panel.classList.contains('hide');
  panel.classList.toggle('hide', !open);
  if (open) fillNotifPanel();
}

function subscribeNotifs() {
  if (notifChan) sb.removeChannel(notifChan);
  notifChan = sb.channel(`notifs-${state.user.id}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${state.user.id}` },
      async (payload) => {
        const n = payload.new;
        const { path } = parseHash();
        const inThisChat = n.type === 'message' && n.mandate_id && path === `/mandats/${n.mandate_id}/conversation`;
        if (inThisChat) { n.is_read = true; state.notifs.unshift(n); markNotifsRead({ id: n.id }); renderBell(); return; }
        state.notifs.unshift(n);
        renderBell();
        toast(`${n.title}${n.body ? ' – ' + n.body : ''}`, 'info');
        document.dispatchEvent(new CustomEvent('notif:new', { detail: n }));
      })
    .subscribe();
}

document.addEventListener('click', (e) => {
  const panel = $('#notifPanel');
  if (panel && !panel.classList.contains('hide') && !panel.contains(e.target)) panel.classList.add('hide');
});

window.addEventListener('hashchange', route);

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && mode === 'app') {
    state.profile = null;
    showLogin('Session expirée. Veuillez vous reconnecter.');
  }
});

boot();
