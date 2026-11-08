import { LOGIN_DOMAIN } from './config.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const ROLE_LABEL = {
  maire: 'Maire', employe: 'Employé de mairie',
  chef_police: 'Chef Police', policier: 'Policier',
  chef_gendarmerie: 'Chef Gendarmerie', gendarme: 'Gendarme',
};
export const ROLE_SERVICE = {
  maire: 'Mairie', employe: 'Mairie',
  chef_police: 'Police', policier: 'Police',
  chef_gendarmerie: 'Gendarmerie', gendarme: 'Gendarmerie',
};
export const ASSIGNABLE_ROLES = ['employe', 'chef_police', 'policier', 'chef_gendarmerie', 'gendarme'];
export const MEMBER_ROLES = ['maire', 'chef_police', 'policier', 'chef_gendarmerie', 'gendarme'];
export const STATUS = { en_attente: ['EN ATTENTE', 'warn'], accepte: ['ACCEPTÉ', 'ok'], refuse: ['REFUSÉ', 'bad'] };
export const SERVICE_LABEL = { police: 'Police', gendarmerie: 'Gendarmerie' };

export const statusBadge = (s) => `<span class="badge ${STATUS[s]?.[1] || 'gray'}">${esc(STATUS[s]?.[0] || s)}</span>`;
export const serviceBadge = (s) => `<span class="badge ${s === 'police' ? 'blue' : 'navy'}">${s === 'police' ? '👮 Police' : '🪖 Gendarmerie'}</span>`;
export const roleBadge = (r) => `<span class="badge ${r === 'maire' ? 'warn' : 'gray'}">${esc(ROLE_LABEL[r] || 'Sans rôle')}</span>`;

const TZ = 'Europe/Paris';
export const fmtDT = (d) => d ? new Date(d).toLocaleString('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '—';
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
export const fmtHM = (d) => d ? new Date(d).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '';
export const dayKey = (d) => new Date(d).toLocaleDateString('fr-CA', { timeZone: TZ });
export const fmtDay = (d) => new Date(d).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtSize = (n) => !n ? '' : n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1048576).toFixed(1)} Mo`;
export const initials = (p, n) => ((p || '?')[0] + (n || '')[0 ] ).toUpperCase();

export const slug = (s) => String(s ?? '')
  .replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const loginEmailFrom = (prenom, nom) => `${slug(prenom)}.${slug(nom)}@${LOGIN_DOMAIN}`;

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function genPassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = crypto.getRandomValues(new Uint32Array(len));
  return [...arr].map((n) => chars[n % chars.length]).join('');
}

export function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('hide'), 3800);
  setTimeout(() => el.remove(), 4300);
}

export function errMsg(e) {
  const m = e?.message || String(e);
  if (/row-level security/i.test(m)) return 'Action non autorisée pour votre rôle.';
  return m;
}

export function openModal({ title, body, footer = '', wide = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-back';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>
    <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $$('[data-close]', wrap).forEach((b) => (b.onclick = close));
  $('#modal-root').append(wrap);
  const first = wrap.querySelector('input:not([type=hidden]),textarea,select');
  if (first) setTimeout(() => first.focus(), 30);
  return { el: wrap, close, q: (s) => wrap.querySelector(s), qa: (s) => [...wrap.querySelectorAll(s)] };
}

export function confirmBox(message, { okLabel = 'Confirmer', danger = false, title = 'Confirmation' } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title, body: `<p style="margin:0">${esc(message)}</p>`,
      footer: `<button class="btn ghost" data-close>Annuler</button><button class="btn ${danger ? 'bad' : ''}" id="okBtn">${esc(okLabel)}</button>`,
    });
    let done = false;
    m.q('#okBtn').onclick = () => { done = true; m.close(); resolve(true); };
    new MutationObserver((_, obs) => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } })
      .observe(document.body, { childList: true, subtree: true });
  });
}

export function openImage(url, title = '') {
  openModal({ title: title || 'Aperçu', wide: true,
    body: `<img class="big" src="${esc(url)}" alt="${esc(title)}">`,
    footer: `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir dans un nouvel onglet</a><button class="btn" data-close>Fermer</button>` });
}

export async function busy(btn, fn) {
  const old = btn?.innerHTML;
  if (btn) { btn.disabled = true; }
  try { return await fn(); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
}

export const formObj = (form) => Object.fromEntries(new FormData(form).entries());
export const nn = (v) => { const t = String(v ?? '').trim(); return t === '' ? null : t; };
