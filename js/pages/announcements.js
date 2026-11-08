import { sb, can, markNotifsRead } from '../state.js';
import { esc, toast, errMsg, fmtDT, openModal, openImage, confirmBox, busy } from '../lib.js';

const BUCKET = 'announcements';
const MAX_SIZE = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const STEP = 20;

export default async function render(view, ctx) {
  let items = [];
  let limit = STEP;
  let more = false;

  const card = (a) => `
    <article class="card announce">
      ${a.image_url ? `<img class="announce-img" src="${esc(a.image_url)}" alt="" data-img="${esc(a.id)}">` : ''}
      <div class="card-head">
        <h2>${esc(a.title)}</h2>
        ${can.mayor() ? `<div class="btn-row">
          <button class="btn sm ghost" data-edit="${esc(a.id)}">Modifier</button>
          <button class="btn sm bad" data-del="${esc(a.id)}">Supprimer</button></div>` : ''}
      </div>
      <p class="muted small" style="margin-top:0">${esc(a.author_name || 'Mairie')} · ${esc(fmtDT(a.created_at))}</p>
      <div class="announce-body">${esc(a.body)}</div>
    </article>`;

  function paint() {
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Annonces</h1><p>Communications officielles de la Mairie d'Amboise.</p></div>
        ${can.mayor() ? '<button class="btn gold" id="newAnn">+ Nouvelle annonce</button>' : ''}
      </div>
      ${items.length ? items.map(card).join('') : '<div class="card empty">Aucune annonce pour le moment.</div>'}
      ${more ? '<div class="center"><button class="btn ghost" id="moreAnn">Voir les annonces précédentes</button></div>' : ''}`;

    view.querySelector('#newAnn')?.addEventListener('click', () => openForm(null));
    view.querySelector('#moreAnn')?.addEventListener('click', async () => { limit += STEP; await load(); });
    view.querySelectorAll('[data-img]').forEach((el) => {
      el.onclick = () => { const a = items.find((x) => x.id === el.dataset.img); if (a) openImage(a.image_url, a.title); };
    });
    view.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => openForm(items.find((x) => x.id === b.dataset.edit));
    });
    view.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => remove(items.find((x) => x.id === b.dataset.del));
    });
  }

  async function load() {
    const { data, error } = await sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    items = data || [];
    more = items.length === limit;
    paint();
  }

  async function remove(a) {
    if (!a) return;
    if (!(await confirmBox(`Supprimer l'annonce « ${a.title} » ?`, { okLabel: 'Supprimer', danger: true }))) return;
    const { error } = await sb.from('announcements').delete().eq('id', a.id);
    if (error) return toast(errMsg(error), 'error');
    if (a.image_path) await sb.storage.from(BUCKET).remove([a.image_path]);
    toast('Annonce supprimée.', 'ok');
    load();
  }

  function openForm(a) {
    let file = null;
    const m = openModal({
      title: a ? "Modifier l'annonce" : 'Nouvelle annonce',
      wide: true,
      body: `<form id="annForm">
        <label>Titre<input name="title" maxlength="200" required value="${esc(a?.title || '')}"></label>
        <label>Message<textarea name="body" rows="8" maxlength="3800">${esc(a?.body || '')}</textarea></label>
        <label>Image (facultative : JPG, PNG, WEBP ou GIF, 5 Mo maximum)
          <input type="file" id="annFile" accept="image/jpeg,image/png,image/webp,image/gif"></label>
        <div id="annPreview">${a?.image_url ? `<img class="announce-img" style="cursor:default" src="${esc(a.image_url)}" alt="">` : ''}</div>
        ${a?.image_url ? `<label class="check"><input type="checkbox" id="annRemove"> Retirer l'image</label>` : ''}
        <p class="muted small">${a
          ? "La modification n'est pas renvoyée sur Discord."
          : "L'annonce sera aussi publiée sur Discord si le webhook est configuré."}</p>
      </form>`,
      footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn gold" id="annSave">Publier</button>',
    });

    m.q('#annFile').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) { file = null; return; }
      if (!TYPES.includes(f.type)) { toast('Format non accepté.', 'error'); e.target.value = ''; file = null; return; }
      if (f.size > MAX_SIZE) { toast('Image trop lourde (5 Mo maximum).', 'error'); e.target.value = ''; file = null; return; }
      file = f;
      m.q('#annPreview').innerHTML = `<img class="announce-img" style="cursor:default" src="${URL.createObjectURL(f)}" alt="">`;
    };

    m.q('#annSave').onclick = (e) => busy(e.currentTarget, async () => {
      const form = m.q('#annForm');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const title = String(fd.get('title') || '').trim();
      const body = String(fd.get('body') || '').trim();
      if (!title) return toast('Le titre est obligatoire.', 'error');

      let image_path = a?.image_path ?? null;
      let image_url = a?.image_url ?? null;
      let uploaded = null;

      try {
        if (file) {
          const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
          uploaded = `${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await sb.storage.from(BUCKET).upload(uploaded, file, { contentType: file.type, cacheControl: '31536000' });
          if (upErr) { uploaded = null; throw upErr; }
          image_path = uploaded;
          image_url = sb.storage.from(BUCKET).getPublicUrl(uploaded).data.publicUrl;
        } else if (m.q('#annRemove')?.checked) {
          image_path = null;
          image_url = null;
        }

        const payload = { title, body, image_path, image_url };
        const { error } = a
          ? await sb.from('announcements').update(payload).eq('id', a.id)
          : await sb.from('announcements').insert(payload);
        if (error) throw error;

        if (a?.image_path && a.image_path !== image_path) await sb.storage.from(BUCKET).remove([a.image_path]);
        toast(a ? 'Annonce modifiée.' : 'Annonce publiée.', 'ok');
        m.close();
        load();
      } catch (err) {
        if (uploaded) await sb.storage.from(BUCKET).remove([uploaded]);
        toast(errMsg(err), 'error');
      }
    });
  }

  await load();
  await markNotifsRead({ type: 'announcement' });
  ctx.refreshNav();

  const chan = sb.channel('announcements-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => load())
    .subscribe();

  return () => { sb.removeChannel(chan); };
}
