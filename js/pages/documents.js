import { sb, can, signedUrls, signedUrl } from '../state.js';
import { esc, toast, errMsg, busy, fmtDT, fmtDate, fmtSize, serviceBadge, openImage } from '../lib.js';
import { fetchMandateFull, personName } from '../data.js';

export default async function render(view) {
  const hasFiles = can.conversations();
  let tab = 'auth';
  let auth = [];
  let files = [];
  let urls = new Map();
  let filter = '';

  view.innerHTML = `
    <div class="page-head"><div><h1>Documents</h1><p>Autorisations de perquisition et fichiers des dossiers.</p></div></div>
    <div class="tabs" id="docTabs">
      <a href="javascript:void(0)" data-tab="auth" class="active">📄 Autorisations de perquisition</a>
      ${hasFiles ? '<a href="javascript:void(0)" data-tab="files">🖼️ Fichiers des dossiers</a>' : ''}
    </div>
    <div class="card"><input id="docFilter" type="search" placeholder="Filtrer…"></div>
    <div id="docBody"><div class="card loading">Chargement…</div></div>`;

  const body = view.querySelector('#docBody');

  const match = (txt) => !filter.trim() || txt.toLowerCase().includes(filter.trim().toLowerCase());

  function paintAuth() {
    const list = auth.filter((m) => match(`${m.number} ${personName(m)} ${m.decided_by_name || ''} ${m.requester_name || ''}`));
    body.innerHTML = `<div class="card">${list.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>N°</th><th>Personne</th><th>Service</th><th>Validé par</th><th>Délivré le</th><th></th></tr></thead>
      <tbody>${list.map((m) => `<tr>
        <td><b>#${esc(m.number)}</b></td><td>${esc(personName(m))}</td><td>${serviceBadge(m.service)}</td>
        <td>${esc(m.decided_by_name || '—')}</td><td>${esc(fmtDate(m.decided_at))}</td>
        <td class="right"><div class="btn-row" style="justify-content:flex-end">
          <button class="btn sm gold" data-pdf="${esc(m.id)}">📄 PDF</button>
          ${can.viewMandates() ? `<a class="btn sm ghost" href="#/mandats/${esc(m.id)}">Ouvrir</a>` : ''}
        </div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucune autorisation.</div>'}</div>`;
  }

  function paintFiles() {
    const list = files.filter((f) => match(`${f.file_name} ${f.uploaded_by_name || ''} ${f.mandates?.number || ''} ${f.mandates ? personName(f.mandates) : ''}`));
    body.innerHTML = `<div class="card">${list.length ? `<div class="files-grid">${list.map((f) => {
      const url = urls.get(f.path);
      const isImg = (f.mime_type || '').startsWith('image/');
      return `<div class="file-card">
        ${isImg && url ? `<div class="thumb" style="background-image:url('${esc(url)}')" data-img="${esc(f.id)}"></div>` : `<div class="thumb" data-open="${esc(f.id)}">📄</div>`}
        <div class="meta"><b title="${esc(f.file_name)}">${esc(f.file_name)}</b>
          <span class="muted">${f.mandates ? `<a href="#/mandats/${esc(f.mandate_id)}">#${esc(f.mandates.number)}</a> · ` : ''}${esc(f.uploaded_by_name || '')}</span>
          <span class="muted">${esc(fmtDT(f.created_at))} ${esc(fmtSize(f.size_bytes))}</span>
          <div class="btn-row" style="margin-top:6px">
            <button class="btn sm ghost" data-open="${esc(f.id)}">Ouvrir</button>
            <button class="btn sm ghost" data-dl="${esc(f.id)}">⬇</button></div>
        </div></div>`;
    }).join('')}</div>` : '<div class="empty">Aucun fichier.</div>'}</div>`;
  }

  const paint = () => (tab === 'auth' ? paintAuth() : paintFiles());

  async function loadAuth() {
    const { data, error } = await sb.from('mandates').select('*').eq('status', 'accepte')
      .order('decided_at', { ascending: false }).limit(300);
    if (error) throw error;
    auth = data || [];
  }

  async function loadFiles() {
    const { data, error } = await sb.from('mandate_files').select('*, mandates(number, person_first, person_last)')
      .order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    files = data || [];
    urls = await signedUrls(files.map((f) => f.path));
  }

  view.querySelector('#docTabs').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-tab]');
    if (!a) return;
    tab = a.dataset.tab;
    view.querySelectorAll('#docTabs a').forEach((x) => x.classList.toggle('active', x === a));
    body.innerHTML = '<div class="card loading">Chargement…</div>';
    try {
      if (tab === 'auth') await loadAuth(); else await loadFiles();
      paint();
    } catch (err) { body.innerHTML = `<div class="card empty">${esc(errMsg(err))}</div>`; }
  });

  view.querySelector('#docFilter').addEventListener('input', (e) => { filter = e.target.value; paint(); });

  view.onclick = async (e) => {
    const pdf = e.target.closest('[data-pdf]');
    const img = e.target.closest('[data-img]');
    const open = e.target.closest('[data-open]');
    const dl = e.target.closest('[data-dl]');
    try {
      if (pdf) {
        await busy(pdf, async () => {
          const full = await fetchMandateFull(pdf.dataset.pdf);
          const { downloadMandatePdf } = await import('../pdf.js');
          await downloadMandatePdf(full);
        });
      } else if (img) {
        const f = files.find((x) => x.id === img.dataset.img);
        if (f) openImage(urls.get(f.path), f.file_name);
      } else if (open) {
        const f = files.find((x) => x.id === open.dataset.open);
        if (f) window.open(urls.get(f.path) || await signedUrl(f.path), '_blank', 'noopener');
      } else if (dl) {
        const f = files.find((x) => x.id === dl.dataset.dl);
        if (f) {
          const a = document.createElement('a');
          a.href = await signedUrl(f.path, { download: f.file_name });
          a.download = f.file_name;
          document.body.append(a); a.click(); a.remove();
        }
      }
    } catch (err) { toast(errMsg(err), 'error'); }
  };

  try {
    await loadAuth();
    paint();
  } catch (err) {
    body.innerHTML = `<div class="card empty">${esc(errMsg(err))}</div>`;
  }

  return () => { view.onclick = null; };
}
