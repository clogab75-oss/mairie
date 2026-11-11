import { sb, state, can } from './state.js';
import { esc, fmtDT, statusBadge, serviceBadge, debounce, errMsg } from './lib.js';
import { personName } from './data.js';

export default async function render(view) {
  const me = state.user.id;
  let seq = 0;
  let filter = '';
  let rows = [];

  view.innerHTML = `
    <div class="page-head"><div><h1>Conversations</h1><p>${can.mayor() ? 'Toutes les conversations des dossiers.' : 'Les dossiers auxquels vous avez accès.'}</p></div></div>
    <div class="card"><input id="convFilter" type="search" placeholder="Filtrer par n° de mandat ou par nom…"></div>
    <div class="card" id="convList"><div class="loading">Chargement…</div></div>`;

  const box = view.querySelector('#convList');

  function paint() {
    const t = filter.trim().toLowerCase();
    const list = rows.filter((r) => !t || `${r.m.number} ${personName(r.m)}`.toLowerCase().includes(t));
    if (!list.length) { box.innerHTML = '<div class="empty">Aucune conversation.</div>'; return; }
    box.innerHTML = list.map(({ m, last, unread }) => `
      <a class="list-item" href="#/mandats/${esc(m.id)}/conversation" style="color:inherit;text-decoration:none">
        <div style="min-width:0">
          <b>#${esc(m.number)} – ${esc(personName(m))}</b> ${statusBadge(m.status)} ${serviceBadge(m.service)}
          <div class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60ch">
            ${last ? `${esc(last.author_name || '?')} : ${esc((last.body || '[pièce jointe]').slice(0, 90))}` : 'Aucun message'}
          </div>
        </div>
        <div class="right">
          <div class="muted small">${esc(fmtDT(last?.created_at || m.created_at))}</div>
          ${unread ? `<span class="badge warn">${unread} non lu${unread > 1 ? 's' : ''}</span>` : ''}
        </div>
      </a>`).join('');
  }

  async function load() {
    const id = ++seq;
    try {
      let mandates = [];
      if (can.mayor()) {
        const { data } = await sb.from('mandates').select('*').order('created_at', { ascending: false }).limit(100);
        mandates = data || [];
      } else {
        const { data: mem } = await sb.from('mandate_members').select('mandate_id').eq('user_id', me);
        const ids = (mem || []).map((r) => r.mandate_id);
        if (ids.length) {
          const { data } = await sb.from('mandates').select('*').in('id', ids).limit(100);
          mandates = data || [];
        }
      }
      const [msgRes, readRes] = await Promise.all([
        sb.from('mandate_messages').select('mandate_id,user_id,author_name,body,created_at').order('created_at', { ascending: false }).limit(500),
        sb.from('mandate_reads').select('mandate_id,last_read_at').eq('user_id', me),
      ]);
      if (id !== seq) return;

      const readAt = new Map((readRes.data || []).map((r) => [r.mandate_id, new Date(r.last_read_at)]));
      const last = new Map();
      const unread = new Map();
      (msgRes.data || []).forEach((msg) => {
        if (!last.has(msg.mandate_id)) last.set(msg.mandate_id, msg);
        const seen = readAt.get(msg.mandate_id);
        if (msg.user_id !== me && (!seen || new Date(msg.created_at) > seen)) {
          unread.set(msg.mandate_id, (unread.get(msg.mandate_id) || 0) + 1);
        }
      });

      rows = mandates.map((m) => ({ m, last: last.get(m.id) || null, unread: unread.get(m.id) || 0 }))
        .sort((a, b) => new Date(b.last?.created_at || b.m.created_at) - new Date(a.last?.created_at || a.m.created_at));
      paint();
    } catch (e) {
      if (id === seq) box.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  }

  view.querySelector('#convFilter').addEventListener('input', (e) => { filter = e.target.value; paint(); });
  await load();

  const soon = debounce(load, 500);
  const chan = sb.channel('conversations-list')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mandate_messages' }, soon)
    .subscribe();
  return () => sb.removeChannel(chan);
}
