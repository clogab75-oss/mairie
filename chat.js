import { icon } from './icons.js';
import { sb, state, can, signedUrls, signedUrl, markNotifsRead, nameOf } from './state.js';
import {
  $, esc, toast, errMsg, fmtHM, fmtDay, dayKey, fmtSize, openImage, openModal, busy, slug,
} from './lib.js';
import { eligibleMembers, MEMBER_GROUPS } from './data.js';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 10 * 1024 * 1024;
const PAGE = 100;

export async function openMembersModal(mandate, onSaved) {
  const { data: cur, error } = await sb.from('mandate_members').select('user_id').eq('mandate_id', mandate.id);
  if (error) { toast(errMsg(error), 'error'); return; }
  const current = new Set((cur || []).map((x) => x.user_id));
  const profs = eligibleMembers();

  const body = `
    <p class="muted small" style="margin-top:0">Les agents cochés (Police et Gendarmerie) ont accès au dossier et à sa conversation. Le maire a toujours accès.</p>
    <input id="memFilter" type="search" placeholder="Filtrer par nom…" style="margin-bottom:10px">
    <div class="pick">${MEMBER_GROUPS.map(([title, roles]) => {
      const list = profs.filter((p) => roles.includes(p.role));
      if (!list.length) return '';
      return `<div class="group">${esc(title)}</div>` + list.map((p) => `
        <label class="check" data-name="${esc((p.prenom + ' ' + p.nom).toLowerCase())}">
          <input type="checkbox" value="${esc(p.id)}" ${current.has(p.id) ? 'checked' : ''} ${p.id === mandate.created_by ? 'disabled' : ''}>
          ${esc(p.prenom)} ${esc(p.nom)}
          ${p.id === mandate.created_by ? '<span class="muted small">(demandeur)</span>' : ''}
        </label>`).join('');
    }).join('') || '<div class="empty">Aucun agent disponible.</div>'}</div>`;

  const m = openModal({
    title: `Agents du dossier #${mandate.number}`, body,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn" id="memSave">Enregistrer</button>',
  });

  m.q('#memFilter').oninput = (e) => {
    const t = e.target.value.trim().toLowerCase();
    m.qa('label.check').forEach((l) => l.classList.toggle('hide', !!t && !l.dataset.name.includes(t)));
  };

  m.q('#memSave').onclick = (e) => busy(e.currentTarget, async () => {
    const checked = new Set(m.qa('input[type=checkbox]:checked').map((i) => i.value));
    if (mandate.created_by) checked.add(mandate.created_by);
    const added = [...checked].filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !checked.has(id));
    try {
      if (added.length) {
        const { error: e1 } = await sb.from('mandate_members').insert(added.map((user_id) => ({ mandate_id: mandate.id, user_id })));
        if (e1) throw e1;
      }
      if (removed.length) {
        const { error: e2 } = await sb.from('mandate_members').delete().eq('mandate_id', mandate.id).in('user_id', removed);
        if (e2) throw e2;
      }
      toast('Agents du dossier mis à jour.', 'ok');
      m.close();
      onSaved?.();
    } catch (err) { toast(errMsg(err), 'error'); }
  });
}

export async function mountChat(box, mandate, { canManage = false, onRead } = {}) {
  const me = state.user.id;
  const id = mandate.id;
  const entries = new Map();
  const fileById = new Map();
  const urls = new Map();
  const reads = new Map();
  let hasMore = false;
  let pending = [];
  let chan = null;
  let readTimer = null;
  const locked = mandate.status === 'cloture' && !can.mayor();

  box.innerHTML = `
  <div class="chat">
    <div class="chat-head">
      <div><b>Mandat #${esc(mandate.number)}</b><div class="muted small">${esc(mandate.person_first)} ${esc(mandate.person_last)}</div></div>
      <div class="btn-row"><div class="chips" id="chatMembers"></div>${canManage ? `<button class="btn sm ghost" id="manageMembers">${icon('users')} Agents</button>` : ''}</div>
    </div>
    <div class="chat-body" id="chatBody"><div class="loading">Chargement…</div></div>
    ${locked ? `<div class="chat-locked">${icon('lock')} Mandat clôturé : la conversation est en lecture seule.</div>` : ''}
    <form class="chat-compose ${locked ? 'hide' : ''}" id="chatForm">
      <div class="pending" id="pending"></div>
      <input type="file" id="fileInput" class="hide" multiple accept="image/jpeg,image/png,image/webp,application/pdf">
      <button type="button" class="icon-btn" id="attachBtn" title="Joindre une photo ou un PDF" aria-label="Joindre un fichier">${icon('paperclip')}</button>
      <textarea id="msgInput" rows="1" placeholder="Écrire un message…" aria-label="Message"></textarea>
      <button class="btn gold" id="sendBtn" aria-label="Envoyer">${icon('send')}</button>
    </form>
  </div>`;

  const body = $('#chatBody', box);
  const input = $('#msgInput', box);

  const order = () => [...entries.values()].sort((a, b) => new Date(a.m.created_at) - new Date(b.m.created_at));

  async function ensureUrls(files) {
    const missing = files.map((f) => f.path).filter((p) => !urls.has(p));
    if (!missing.length) return;
    const map = await signedUrls(missing);
    map.forEach((u, p) => urls.set(p, u));
  }

  function readersOf(m) {
    return [...reads.entries()]
      .filter(([uid, at]) => uid !== me && new Date(at) >= new Date(m.created_at))
      .map(([uid]) => nameOf(uid));
  }

  function attHtml(f) {
    const url = urls.get(f.path) || '';
    const isImg = (f.mime_type || '').startsWith('image/');
    return `${isImg && url ? `<img src="${esc(url)}" alt="${esc(f.file_name)}" data-img="${esc(f.id)}" loading="lazy">` : ''}
      <div class="att-file"><span>${icon(isImg ? 'image' : 'file')} ${esc(f.file_name)} <small class="muted">${esc(fmtSize(f.size_bytes))}</small></span>
        <button type="button" class="btn sm ghost" data-open="${esc(f.id)}">Ouvrir</button>
        <button type="button" class="btn sm ghost" data-dl="${esc(f.id)}" title="Télécharger">${icon('download')}</button></div>`;
  }

  function msgHtml(e, isLastMine) {
    const m = e.m;
    const mine = m.user_id === me;
    let status = '';
    if (mine && isLastMine) {
      const r = readersOf(m);
      status = r.length ? ` · ${icon('checks')} Lu par ${esc(r.join(', '))}` : ` · ${icon('check')} Envoyé`;
    }
    return `<div class="msg ${mine ? 'me' : ''}" data-id="${esc(m.id)}">
      <div class="author">${esc(m.author_name || nameOf(m.user_id))}</div>
      ${m.body ? `<div class="text">${esc(m.body)}</div>` : ''}
      ${e.files.length ? `<div class="atts">${e.files.map(attHtml).join('')}</div>` : ''}
      <div class="time">${esc(fmtHM(m.created_at))}${status}</div></div>`;
  }

  function paint() {
    const list = order();
    if (!list.length) { body.innerHTML = '<div class="empty">Aucun message. Écrivez le premier !</div>'; return; }
    const lastMine = [...list].reverse().find((e) => e.m.user_id === me);
    let last = '';
    let html = hasMore ? '<button type="button" class="btn sm ghost" data-more style="align-self:center">Charger les messages précédents</button>' : '';
    list.forEach((e) => {
      const dk = dayKey(e.m.created_at);
      if (dk !== last) { html += `<div class="day-sep">${esc(fmtDay(e.m.created_at))}</div>`; last = dk; }
      html += msgHtml(e, e === lastMine);
    });
    body.innerHTML = html;
  }

  const scrollBottom = () => { body.scrollTop = body.scrollHeight; };
  const nearBottom = () => body.scrollHeight - body.scrollTop - body.clientHeight < 140;

  async function addMessages(msgs, files = []) {
    msgs.forEach((m) => { if (!entries.has(m.id)) entries.set(m.id, { m, files: [] }); });
    await ensureUrls(files);
    files.forEach((f) => {
      const e = entries.get(f.message_id);
      if (e && !e.files.some((x) => x.id === f.id)) e.files.push(f);
      fileById.set(f.id, f);
    });
  }

  async function filesFor(msgIds) {
    if (!msgIds.length) return [];
    const { data } = await sb.from('mandate_files').select('*').eq('mandate_id', id).in('message_id', msgIds);
    return data || [];
  }

  async function loadInitial() {
    const { data: ms, error } = await sb.from('mandate_messages').select('*').eq('mandate_id', id)
      .order('created_at', { ascending: false }).limit(PAGE);
    if (error) throw error;
    hasMore = (ms || []).length === PAGE;
    const asc = (ms || []).slice().reverse();
    await addMessages(asc, await filesFor(asc.map((m) => m.id)));
    const { data: rs } = await sb.from('mandate_reads').select('*').eq('mandate_id', id);
    (rs || []).forEach((r) => reads.set(r.user_id, r.last_read_at));
    paint();
    scrollBottom();
  }

  async function loadMore() {
    const oldest = order()[0];
    if (!oldest) return;
    const { data: ms } = await sb.from('mandate_messages').select('*').eq('mandate_id', id)
      .lt('created_at', oldest.m.created_at).order('created_at', { ascending: false }).limit(PAGE);
    hasMore = (ms || []).length === PAGE;
    const before = body.scrollHeight;
    await addMessages(ms || [], await filesFor((ms || []).map((m) => m.id)));
    paint();
    body.scrollTop = body.scrollHeight - before;
  }

  async function refreshMembers() {
    const { data } = await sb.from('mandate_members').select('user_id').eq('mandate_id', id);
    $('#chatMembers', box).innerHTML = (data || []).map((r) => `<span class="chip">${esc(nameOf(r.user_id))}</span>`).join('');
  }

  function markRead() {
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      if (document.hidden) return;
      const at = new Date().toISOString();
      await sb.from('mandate_reads').upsert({ mandate_id: id, user_id: me, last_read_at: at }, { onConflict: 'mandate_id,user_id' });
      reads.set(me, at);
      await markNotifsRead({ mandate_id: id, type: 'message' });
      onRead?.();
    }, 400);
  }

  function renderPending() {
    $('#pending', box).innerHTML = pending.map((f, i) => `<span class="chip">${icon(/^image\//.test(f.type) ? 'image' : 'file')} ${esc(f.name)} <button type="button" class="icon-btn" data-rm="${i}" aria-label="Retirer" style="padding:0 4px">${icon('x')}</button></span>`).join('');
  }
  function addPending(files) {
    [...files].forEach((f) => {
      if (!ALLOWED.includes(f.type)) { toast(`« ${f.name} » : format non accepté (JPG, PNG, WEBP ou PDF).`, 'error'); return; }
      if (f.size > MAX_SIZE) { toast(`« ${f.name} » dépasse 10 Mo.`, 'error'); return; }
      pending.push(f);
    });
    renderPending();
  }

  async function uploadFile(msg, file) {
    const dot = file.name.lastIndexOf('.');
    const ext = (dot > 0 ? file.name.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const base = slug(dot > 0 ? file.name.slice(0, dot) : file.name) || 'fichier';
    const path = `${id}/${crypto.randomUUID()}-${base}${ext ? '.' + ext : ''}`;
    const { error: upErr } = await sb.storage.from('mandate-files').upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw upErr;
    const { data: row, error } = await sb.from('mandate_files').insert({
      mandate_id: id, message_id: msg.id, path, file_name: file.name,
      mime_type: file.type, size_bytes: file.size, uploaded_by: me,
    }).select().single();
    if (error) throw error;
    return row;
  }

  async function send(e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !pending.length) return;
    const files = pending.slice();
    await busy($('#sendBtn', box), async () => {
      try {
        const { data: msg, error } = await sb.from('mandate_messages')
          .insert({ mandate_id: id, user_id: me, body: text }).select().single();
        if (error) throw error;
        input.value = ''; input.style.height = '';
        pending = []; renderPending();
        await addMessages([msg]);
        paint(); scrollBottom();
        for (const f of files) {
          try {
            const row = await uploadFile(msg, f);
            await addMessages([], [row]);
            paint(); scrollBottom();
          } catch (err) { toast(`Envoi de « ${f.name} » impossible : ${errMsg(err)}`, 'error'); }
        }
        markRead();
      } catch (err) { toast(errMsg(err), 'error'); }
    });
    input.focus();
  }

  $('#chatForm', box).onsubmit = send;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chatForm', box).requestSubmit(); }
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; });
  input.addEventListener('paste', (e) => { if (e.clipboardData?.files?.length) { addPending(e.clipboardData.files); } });
  $('#attachBtn', box).onclick = () => $('#fileInput', box).click();
  $('#fileInput', box).onchange = (e) => { addPending(e.target.files); e.target.value = ''; };
  $('#pending', box).addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { pending.splice(Number(b.dataset.rm), 1); renderPending(); }
  });

  body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-more]')) { loadMore(); return; }
    const img = e.target.closest('[data-img]');
    if (img) { const f = fileById.get(img.dataset.img); if (f) openImage(urls.get(f.path), f.file_name); return; }
    const op = e.target.closest('[data-open]');
    if (op) { const f = fileById.get(op.dataset.open); if (f) window.open(urls.get(f.path) || await signedUrl(f.path), '_blank', 'noopener'); return; }
    const dl = e.target.closest('[data-dl]');
    if (dl) {
      const f = fileById.get(dl.dataset.dl);
      if (!f) return;
      try {
        const a = document.createElement('a');
        a.href = await signedUrl(f.path, { download: f.file_name });
        a.download = f.file_name;
        document.body.append(a); a.click(); a.remove();
      } catch (err) { toast(errMsg(err), 'error'); }
    }
  });

  $('#manageMembers', box)?.addEventListener('click', () => openMembersModal(mandate, refreshMembers));

  const onFocus = () => { if (!document.hidden) markRead(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);

  const filter = `mandate_id=eq.${id}`;
  chan = sb.channel(`chat-${id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mandate_messages', filter }, async (p) => {
      const stick = nearBottom() || p.new.user_id === me;
      await addMessages([p.new]);
      paint();
      if (stick) scrollBottom();
      if (p.new.user_id !== me) markRead();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mandate_files', filter }, async (p) => {
      const stick = nearBottom();
      await addMessages([], [p.new]);
      paint();
      if (stick) scrollBottom();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mandate_reads', filter }, (p) => {
      if (p.new?.user_id) { reads.set(p.new.user_id, p.new.last_read_at); paint(); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mandate_members', filter }, () => refreshMembers())
    .subscribe();

  try {
    await Promise.all([loadInitial(), refreshMembers()]);
    markRead();
  } catch (err) {
    body.innerHTML = `<div class="empty">${esc(errMsg(err))}</div>`;
  }

  return () => {
    clearTimeout(readTimer);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
    if (chan) sb.removeChannel(chan);
  };
}
