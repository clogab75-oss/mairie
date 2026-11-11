import { sb, can } from './state.js';
import { esc, debounce, errMsg } from './lib.js';
import { searchMandates, mandatesTable, bindRowLinks } from './data.js';

export default async function render(view, ctx) {
  const q0 = ctx.query || {};

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Mandats / Perquisitions</h1><p>Police et Gendarmerie peuvent consulter les mandats des deux services.</p></div>
      ${can.createMandate() ? '<a class="btn gold" href="#/mandats/nouveau">+ Nouvelle demande</a>' : ''}
    </div>
    <div class="card">
      <div class="toolbar">
        <label>Recherche<input id="fQ" type="search" placeholder="N°, nom, prénom, plaque, terrain, agent…" value="${esc(q0.q || '')}"></label>
        <label>Service<select id="fService">
          <option value="">Tous</option>
          <option value="police" ${q0.service === 'police' ? 'selected' : ''}>Police</option>
          <option value="gendarmerie" ${q0.service === 'gendarmerie' ? 'selected' : ''}>Gendarmerie</option></select></label>
        <label>Statut<select id="fStatus">
          <option value="">Tous</option>
          <option value="en_attente" ${q0.status === 'en_attente' ? 'selected' : ''}>En attente</option>
          <option value="accepte" ${q0.status === 'accepte' ? 'selected' : ''}>Accepté</option>
          <option value="refuse" ${q0.status === 'refuse' ? 'selected' : ''}>Refusé</option>
          <option value="cloture" ${q0.status === 'cloture' ? 'selected' : ''}>Clôturé</option></select></label>
        <label>Du<input type="date" id="fFrom"></label>
        <label>Au<input type="date" id="fTo"></label>
        <button class="btn ghost" id="fReset" type="button">Réinitialiser</button>
      </div>
    </div>
    <div class="card" id="results"><div class="loading">Chargement…</div></div>`;

  const $q = (s) => view.querySelector(s);
  let seq = 0;

  async function run() {
    const id = ++seq;
    const box = $q('#results');
    try {
      const rows = await searchMandates({
        q: $q('#fQ').value.trim(),
        service: $q('#fService').value,
        status: $q('#fStatus').value,
        from: $q('#fFrom').value,
        to: $q('#fTo').value,
      });
      if (id !== seq) return;
      box.innerHTML = `<p class="muted small" style="margin-top:0">${rows.length} résultat${rows.length > 1 ? 's' : ''}</p>${mandatesTable(rows, { empty: 'Aucun mandat ne correspond à la recherche.' })}`;
      bindRowLinks(box);
    } catch (e) {
      if (id === seq) box.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  }

  const runSoon = debounce(run, 300);
  $q('#fQ').addEventListener('input', runSoon);
  ['#fService', '#fStatus', '#fFrom', '#fTo'].forEach((s) => $q(s).addEventListener('change', run));
  $q('#fReset').onclick = () => {
    $q('#fQ').value = ''; $q('#fService').value = ''; $q('#fStatus').value = ''; $q('#fFrom').value = ''; $q('#fTo').value = '';
    run();
  };

  await run();

  const chan = sb.channel('mandates-list')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mandates' }, () => runSoon())
    .subscribe();
  return () => sb.removeChannel(chan);
}
