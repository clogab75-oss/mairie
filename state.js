import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { ROLE_SERVICE } from './lib.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export const DEFAULT_SETTINGS = {
  mairie_name: "MAIRIE D'AMBOISE",
  maire_name: 'Gabin Muller',
  maire_title: "Maire d'Amboise",
  number_prefix: '',
  number_pad: 4,
  pdf_city: 'Amboise',
  pdf_extra: 'République française – Nova Life RP',
  pdf_footer: "Document officiel de la Mairie d'Amboise – Nova Life RP",
  notify_new: true,
  notify_decision: true,
  notify_message: true,
  discord_message_preview: false,
  logo_path: null,
  stamp_path: null,
  signature_path: null,
};

export const state = {
  user: null,
  profile: null,
  profiles: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  notifs: [],
};

const role = () => state.profile?.role;
const FORCE = ['chef_police', 'policier', 'chef_gendarmerie', 'gendarme'];

export const can = {
  mayor: () => role() === 'maire',
  chef: () => ['chef_police', 'chef_gendarmerie'].includes(role()),
  force: () => FORCE.includes(role()),
  employe: () => role() === 'employe',
  perm: (p) => role() === 'employe' && !!state.profile?.permissions?.[p],
  createMandate: () => ['chef_police', 'chef_gendarmerie'].includes(role()),
  viewMandates: () => role() === 'maire' || FORCE.includes(role()) || can.perm('mandates'),
  conversations: () => role() === 'maire' || FORCE.includes(role()),
  history: () => role() === 'maire' || FORCE.includes(role()) || can.perm('history'),
  documents: () => role() === 'maire' || FORCE.includes(role()) || can.perm('documents'),
};

export const nameOf = (id) => {
  const p = state.profiles.get(id);
  return p ? `${p.prenom} ${p.nom}` : 'Utilisateur supprimé';
};
export const serviceOfProfile = (p) => ROLE_SERVICE[p?.role] || '';

export async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('*').order('nom');
  if (error) throw error;
  state.profiles = new Map(data.map((p) => [p.id, p]));
  return data;
}

export async function loadSettings() {
  const { data } = await sb.from('settings').select('key,value');
  const s = { ...DEFAULT_SETTINGS };
  (data || []).forEach((r) => { s[r.key] = r.value; });
  state.settings = s;
  return s;
}

export async function loadNotifications() {
  const { data } = await sb.from('notifications').select('*')
    .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(40);
  state.notifs = data || [];
  return state.notifs;
}

export async function loadSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return false;
  state.user = session.user;
  const { data: me, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error || !me) return 'missing';
  if (!me.role) return 'pending';
  if (!me.is_active) return 'inactive';
  state.profile = me;
  await Promise.all([loadProfiles(), loadSettings(), loadNotifications()]);
  sb.rpc('touch_login').then(() => {});
  return true;
}

export async function signedUrl(path, { download } = {}) {
  const { data, error } = await sb.storage.from('mandate-files').createSignedUrl(path, 3600, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
export async function signedUrls(paths) {
  if (!paths.length) return new Map();
  const { data } = await sb.storage.from('mandate-files').createSignedUrls(paths, 3600);
  return new Map((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}

export async function markNotifsRead(filter = {}) {
  let q = sb.from('notifications').update({ is_read: true }).eq('user_id', state.user.id).eq('is_read', false);
  Object.entries(filter).forEach(([k, v]) => { q = q.eq(k, v); });
  await q;
  state.notifs.forEach((n) => {
    if (!n.is_read && Object.entries(filter).every(([k, v]) => n[k] === v)) n.is_read = true;
  });
}
