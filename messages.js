import { sb, state, can, markNotifsRead } from './state.js';
import { esc, toast, errMsg, openModal, confirmBox, busy, fmtDT, nn } from './lib.js';
import { icon } from './icons.js';

export default async function render(view, ctx) {
  const mayor = can.mayor();
  let rows = [];

  async function load() {
    let q = sb.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(200);
    if (!mayor) q = q.eq('user_id', state.user.id);
    const { data, error } = await q;
    if (error) throw error;
    rows = data || [];
  }

  const item = (m) => `
    <div class="list-item" style="flex-direction:column;align-items:stretch;gap:8px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <b>${esc(m.subject)}</b>
          ${mayor ? `<div class="muted small">${esc(m.author_name || '')}</div>` : ''}
        </div>
        <span class="muted small">${esc(fmtDT(m.created_at))}</span>
      </div>
      <div style="white-space:pre-wrap;word-break:break-word">${esc(m.body)}</div>
      ${m.reply ? `<div style="border-left:3px solid var(--gold);padding-left:12px">
        <div class="muted small">Réponse de ${esc(m.replied_by_name || 'la Mairie')} · ${esc(fmtDT(m.replied_at))}</div>
        <div style="white-space:pre-wrap;word-break:break-word">${esc(m.reply)}</div></div>` : ''}
      <div class="btn-row">
        ${mayor ? `<button class="btn sm ${m.reply ? 'ghost' : 'gold'}" data-act="reply" data-id="${esc(m.id)}">${icon('send')} ${m.reply ? 'Modifier la réponse' : 'Répondre'}</button>` : ''}
        <button class="btn sm ghost" data-act="del" data-id="${esc(m.id)}">${icon('trash')} Supprimer</button>
      </div>
    </div>`;

  function paint() {
    const list = rows.length ? rows.map(item).join('') : `<div class="empty">${mayor ? 'Aucun message pour le moment.' : "Vous n'avez pas encore écrit au maire."}</div>`;
    view.innerHTML = mayor
      ? `<div class="page-head"><div><h1>Messages reçus</h1><p>Messages envoyés par les habitants.</p></div></div>
         <div class="card">${list}</div>`
      : `<div class="page-head"><div><h1>Contacter le maire</h1><p>Écrivez directement au maire, il vous répondra ici.</p></div></div>
         <div class="card">
           <form id="msgForm">
             <label>Objet<input name="subject" maxlength="150" required></label>
             <label>Message<textarea name="body" maxlength="3000" rows="5" required></textarea></label>
             <button class="btn gold" type="submit">${icon('send')} Envoyer</button>
           </form>
         </div>
         <div class="card"><div class="card-head"><h2>Mes messages</h2></div>${list}</div>`;
  }

  async function reply(m) {
    const dlg = openModal({
      title: `Répondre à ${m.author_name || ''}`,
      body: `<p class="muted small" style="margin-top:0">${esc(m.subject)}</p>
        <label>Votre réponse<textarea id="rText" maxlength="3000" rows="6">${esc(m.reply || '')}</textarea></label>`,
      footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn gold" id="rOk">Envoyer la réponse</button>',
    });
    dlg.q('#rOk').onclick = (e) => busy(e.currentTarget, async () => {
      const text = nn(dlg.q('#rText').value);
      if (!text) return toast('Écrivez une réponse.', 'error');
      const { error } = await sb.from('contact_messages').update({ reply: text }).eq('id', m.id);
      if (error) return toast(errMsg(error), 'error');
      dlg.close();
      toast('Réponse envoyée.', 'ok');
      await load();
      paint();
    });
  }

  async function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const m = rows.find((x) => x.id === b.dataset.id);
    if (!m) return;
    if (b.dataset.act === 'reply') return reply(m);
    if (b.dataset.act === 'del' && await confirmBox('Supprimer ce message ?', { okLabel: 'Supprimer', danger: true })) {
      const { error } = await sb.from('contact_messages').delete().eq('id', m.id);
      if (error) return toast(errMsg(error), 'error');
      rows = rows.filter((x) => x.id !== m.id);
      paint();
    }
  }

  view.addEventListener('click', onClick);
  view.addEventListener('submit', async (e) => {
    if (e.target.id !== 'msgForm') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    await busy(btn, async () => {
      const { error } = await sb.from('contact_messages').insert({
        user_id: state.user.id,
        subject: String(f.get('subject')).trim(),
        body: String(f.get('body')).trim(),
      });
      if (error) return toast(errMsg(error), 'error');
      toast('Message envoyé au maire.', 'ok');
      await load();
      paint();
    });
  });

  await load();
  paint();
  await markNotifsRead({ type: mayor ? 'contact' : 'contact_reply' });
  if (mayor) {
    const unread = rows.filter((m) => !m.is_read).map((m) => m.id);
    if (unread.length) await sb.from('contact_messages').update({ is_read: true }).in('id', unread);
  }
  ctx.refreshNav();
}
