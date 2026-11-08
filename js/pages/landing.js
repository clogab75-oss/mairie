import { sb, state } from '../state.js';
import { esc, errMsg } from '../lib.js';
import { brandURL } from '../branding.js';
import { announcementCard, filterChips, bindAnnouncements } from '../announcement-ui.js';

export default async function render(view, ctx) {
  const all = !!ctx.all;
  const s = state.settings;
  let items = [];
  let cat = '';
  let failed = '';

  const list = () => (cat ? items.filter((a) => a.category === cat) : items);

  function paintList() {
    const box = view.querySelector('#annList');
    const rows = list();
    if (failed) {
      box.innerHTML = `<div class="card error">${esc(failed)}</div>`;
      return;
    }
    box.innerHTML = rows.length
      ? `<div class="ann-grid">${rows.map((a, i) => announcementCard(a, { feature: !all && !cat && i === 0 && rows.length > 1 })).join('')}</div>`
      : '<div class="card empty">Aucune annonce dans cette catégorie pour le moment.</div>';
    bindAnnouncements(box, rows);
  }

  const hero = `
    <section class="hero">
      <div class="hero-inner">
        <div>
          <span class="eyebrow">Nova Life RP · Commune d'Amboise</span>
          <h1>Bienvenue à ${esc(s.mairie_name.replace(/^MAIRIE D'/i, '').replace(/^mairie d'/i, '') || 'Amboise')}</h1>
          <p class="lead">Retrouvez ici les annonces citoyennes de la Mairie : événements, travaux, informations de sécurité et communications officielles.</p>
          <div class="btn-row">
            <a class="btn gold lg" href="#/annonces">📢 Voir les annonces</a>
            <a class="btn ghost lg" href="#/connexion">Espace agents</a>
          </div>
        </div>
        <img class="hero-logo" src="${esc(brandURL('logo'))}" alt="Blason de la Mairie d'Amboise">
      </div>
    </section>`;

  view.innerHTML = `
    ${all ? '' : hero}
    <section class="section" id="annonces">
      <div class="section-head">
        <div>
          <span class="eyebrow-dark">Annonces citoyennes</span>
          <h2>${all ? 'Toutes les annonces' : 'Dernières nouvelles de la commune'}</h2>
        </div>
        ${filterChips(cat)}
      </div>
      <div id="annList"><div class="loading">Chargement des annonces…</div></div>
      ${all ? '' : '<div class="center" style="margin-top:28px"><a class="btn ghost" href="#/annonces">Voir toutes les annonces</a></div>'}
    </section>
    ${all ? '' : `
    <section class="section" style="padding-top:0">
      <div class="mayor-card">
        <img class="stamp" src="${esc(brandURL('stamp'))}" alt="Tampon officiel">
        <div>
          <span class="eyebrow-dark">Le mot du Maire</span>
          <h3>${esc(s.maire_name)}</h3>
          <p class="muted" style="margin:6px 0 0;max-width:60ch">${esc(s.maire_title)} – au service des habitants d'Amboise.</p>
          <img class="sign" src="${esc(brandURL('signature'))}" alt="Signature du maire">
        </div>
      </div>
    </section>`}`;

  view.querySelectorAll('.fchip').forEach((b) => {
    b.onclick = () => {
      cat = b.dataset.cat;
      view.querySelectorAll('.fchip').forEach((x) => x.classList.toggle('active', x === b));
      paintList();
    };
  });

  const q = sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(all ? 100 : 7);
  const { data, error } = await q;
  if (error) failed = errMsg(error);
  items = data || [];
  paintList();
}
