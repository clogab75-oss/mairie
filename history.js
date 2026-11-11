import { sb } from './state.js';
import { esc, fmtDT, debounce, errMsg } from './lib.js';

const STEP = 50;

export default async function render(view) {
  let limit = STEP;
  let seq = 0;

  view.innerHTML = `
    <div class="page-head"><div><h1>Historique</h1><p>Traçabilité de toutes les actions sur les mandats.</p></div></div>
    <div class="card">
      <div class="grid3">
        <label>Recherche<input id="hQ" type="search" placeholder="Agent, n° de mandat, action…"></label>
        <label>Du<input type="date" id="hFrom"></label>
        <label>Au<input type="date" id="hTo"></label>
      </div>
    </div>
    <div class="card" id="hList"><div class="loading">Chargement…</div></div>`;

  const $q = (s) => view.querySelector(s);

  async function run() {
    const id = ++seq;
    const box = $q('#hList');
    try {
      let q = sb.from('mandate_history').select('*').order('created_at', { ascending: false }).limit(limit);
      const t = $q('#hQ').value.replace(/[,()%*\\]/g, ' ').trim();
      if (t) q = q.or(`message.ilike.%${t}%,actor_name.ilike.%${t}%,mandate_number.ilike.%${t}%`);
      const from = $q('#hFrom').value;
      const to = $q('#hTo').value;
      if (from) q = q.gte('created_at', new Date(`${from}T00:00:00`).toISOString());
      if (to) q = q.lte('created_at', new Date(`${to}T23:59:59.999`).toISOString());
      const { data, error } = await q;
      if (error) throw error;
      if (id !== seq) return;
      const rows = data || [];
      box.innerHTML = rows.length ? `
        <div class="timeline">${rows.map((h) => `
          <div class="tl-item">
            <div class="when">${esc(fmtDT(h.created_at))}</div>
            <div class="who">${esc(h.actor_name || 'Système')}</div>
            <div>${h.mandate_id ? `<a href="#/mandats/${esc(h.mandate_id)}">${esc(h.message)}</a>` : esc(h.message)}</div>
          </div>`).join('')}</div>
        ${rows.length === limit ? '<div class="center"><button class="btn ghost" id="hMore">Charger plus</button></div>' : ''}`
        : '<div class="empty">Aucun événement.</div>';
      $q('#hMore')?.addEventListener('click', () => { limit += STEP; run(); });
    } catch (e) {
      if (id === seq) box.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  }

  const soon = debounce(() => { limit = STEP; run(); }, 300);
  $q('#hQ').addEventListener('input', soon);
  $q('#hFrom').addEventListener('change', soon);
  $q('#hTo').addEventListener('change', soon);
  await run();
}
