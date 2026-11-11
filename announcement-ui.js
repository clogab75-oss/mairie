import { esc, openModal, openImage } from './lib.js';
import { icon } from './icons.js';

export const CATEGORIES = {
  information: { label: 'Information', emoji: 'info' },
  evenement: { label: 'Événement', emoji: 'calendar' },
  travaux: { label: 'Travaux', emoji: 'cone' },
  securite: { label: 'Sécurité', emoji: 'shield' },
  urgent: { label: 'Urgent', emoji: 'alert' },
};

const catOf = (a) => (CATEGORIES[a?.category] ? a.category : 'information');

export const catBadge = (c) => {
  const k = CATEGORIES[c] ? c : 'information';
  return `<span class="cat cat-${k}">${icon(CATEGORIES[k].emoji)} ${esc(CATEGORIES[k].label)}</span>`;
};

export const longDate = (d) => new Date(d).toLocaleDateString('fr-FR', {
  timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric',
});

export function announcementCard(a, { feature = false, manage = false } = {}) {
  const k = catOf(a);
  const media = a.image_url
    ? `<div class="ann-media" style="background-image:url('${esc(a.image_url)}')" role="img" aria-label="${esc(a.title)}"></div>`
    : `<div class="ann-media ann-ph ph-${k}"><span>${icon(CATEGORIES[k].emoji)}</span></div>`;
  return `
    <article class="ann ${feature ? 'feature' : ''} ${k === 'urgent' ? 'is-urgent' : ''}" tabindex="0" data-open="${esc(a.id)}">
      ${media}
      <div class="ann-body">
        <div class="ann-meta">${catBadge(k)}<time datetime="${esc(a.created_at)}">${esc(longDate(a.created_at))}</time></div>
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.body)}</p>
        <div class="ann-foot">
          <span class="small muted">Par ${esc(a.author_name || 'la Mairie')}</span>
          ${manage
            ? `<span class="btn-row">
                <button class="btn sm ghost" data-edit="${esc(a.id)}">Modifier</button>
                <button class="btn sm bad" data-del="${esc(a.id)}">Supprimer</button></span>`
            : `<span class="ann-more">Lire ${icon('arrowright')}</span>`}
        </div>
      </div>
    </article>`;
}

export function filterChips(active) {
  const all = [['', 'Toutes'], ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])];
  return `<div class="filters" role="tablist">${all.map(([k, l]) =>
    `<button type="button" class="fchip ${k === active ? 'active' : ''}" data-cat="${k}">${esc(l)}</button>`).join('')}</div>`;
}

export function openAnnouncement(a) {
  const k = catOf(a);
  const m = openModal({
    title: 'Annonce citoyenne',
    wide: true,
    body: `
      ${a.image_url ? `<img class="big" src="${esc(a.image_url)}" alt="${esc(a.title)}" id="annImg" style="cursor:zoom-in">` : ''}
      <div class="ann-modal-head">${catBadge(k)}<span class="muted small">${esc(longDate(a.created_at))} · Par ${esc(a.author_name || 'la Mairie')}</span></div>
      <h2 class="ann-modal-title">${esc(a.title)}</h2>
      <div class="ann-full">${esc(a.body) || '<span class="muted">Aucun détail supplémentaire.</span>'}</div>`,
    footer: '<button class="btn ghost" data-close>Fermer</button>',
  });
  m.q('#annImg')?.addEventListener('click', () => openImage(a.image_url, a.title));
  return m;
}

export function bindAnnouncements(root, items, { onEdit, onDelete } = {}) {
  const find = (id) => items.find((x) => x.id === id);
  root.querySelectorAll('[data-open]').forEach((el) => {
    const open = () => { const a = find(el.dataset.open); if (a) openAnnouncement(a); };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) open(); });
  });
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    onEdit?.(find(b.dataset.edit));
  }));
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    onDelete?.(find(b.dataset.del));
  }));
}
