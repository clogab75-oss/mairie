import { sb, state, can, signedUrls, signedUrl } from '../state.js';
import {
  esc, toast, errMsg, busy, nn, fmtDT, fmtDate, statusBadge, serviceBadge, roleBadge,
  openModal, confirmBox, openImage, debounce,
} from '../lib.js';
import { fetchMandateFull, personName } from '../data.js';
import { mountChat, openMembersModal } from '../chat.js';

const KINDS = {
  complice: {
    table: 'mandate_complices', key: 'complices', label: 'complice',
    fields: [['prenom', 'Prénom', true], ['nom', 'Nom', true], ['infos', 'Informations complémentaires', false]],
  },
  terrain: {
    table: 'mandate_terrains', key: 'terrains', label: 'terrain',
    fields: [['numero', 'Numéro du terrain', true], ['adresse', 'Adresse / localisation', false], ['infos', 'Informations supplémentaires', false]],
  },
  vehicle: {
    table: 'mandate_vehicles', key: 'vehicles', label: 'véhicule',
    fields: [['marque', 'Marque', false], ['modele', 'Modèle', false], ['couleur', 'Couleur', false], ['plaque', 'Plaque', false], ['infos', 'Informations supplémentaires', false]],
  },
};

const EDIT_FIELDS = [
  ['person_first', 'Prénom', true, 'input'],
  ['person_last', 'Nom', true, 'input'],
  ['person_info', 'Informations sur la personne', false, 'textarea'],
  ['agents_concernes', 'Agents concernés', false, 'textarea'],
  ['motif', 'Motif de la perquisition', true, 'textarea'],
  ['description', 'Description détaillée', false, 'textarea'],
  ['preuves', 'Éléments de preuve', false, 'textarea'],
  ['objets_recherches', 'Objets recherchés', false, 'textarea'],
  ['risques', 'Risques éventuels', false, 'textarea'],
  ['date_souhaitee', 'Date souhaitée', false, 'date'],
  ['heure_souhaitee', 'Heure souhaitée', false, 'time'],
  ['infos_complementaires', 'Informations complémentaires', false, 'textarea'],
];

const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `
  <dt>${esc(k)}</dt><dd>${v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : v}</dd>`).join('')}</dl>`;

export default async function render(view, ctx) {
  const id = ctx.params[0];
  const me = state.user.id;
  const isConv = ctx.tab === 'conversation';
  let full = await fetchMandateFull(id);
  let chatCleanup = null;
  let chan = null;
  let files = [];
  let urls = new Map();

  const isMember = () => full.members.some((x) => x.user_id === me);
  const canChat = () => can.mayor() || isMember();
  const canEdit = () => can.mayor() || (can.chef() && (full.mandate.created_by === me || isMember()));

  const head = () => {
    const m = full.mandate;
    const acts = [];
    if (can.mayor() && m.status === 'en_attente') {
      acts.push('<button class="btn ok" data-act="accept">✅ Accepter</button>');
      acts.push('<button class="btn bad" data-act="refuse">❌ Refuser</button>');
    }
    if (can.mayor() && m.status !== 'en_attente') acts.push('<button class="btn ghost" data-act="reset">Remettre en attente</button>');
    if (m.status === 'accepte') acts.push("<button class=\"btn gold\" data-act=\"pdf\">📄 Télécharger l'autorisation de perquisition</button>");
    if (canEdit() && !isConv) acts.push('<button class="btn ghost" data-act="edit">✏️ Modifier</button>');
    if (can.mayor() && !isConv) acts.push('<button class="btn ghost" data-act="delete">🗑️ Supprimer</button>');
    return `
      <div class="page-head">
        <div><h1>Mandat #${esc(m.number)}</h1><p>${esc(personName(m))} · ${statusBadge(m.status)} ${serviceBadge(m.service)}</p></div>
        <div class="btn-row">${acts.join('')}</div>
      </div>
      <div class="tabs">
        <a href="#/mandats/${esc(id)}" class="${isConv ? '' : 'active'}">Détails</a>
        ${canChat() ? `<a href="#/mandats/${esc(id)}/conversation" class="${isConv ? 'active' : ''}">💬 Conversation</a>` : ''}
      </div>`;
  };

  const itemLine = (kind, it) => {
    let main;
    if (kind === 'complice') {
      main = `<b>${esc(`${it.prenom} ${it.nom}`.trim())}</b>${it.infos ? `<div class="muted small">${esc(it.infos)}</div>` : ''}`;
    } else if (kind === 'terrain') {
      main = `<b>Terrain #${esc(it.numero)}</b>${it.adresse ? ` <span class="muted">– ${esc(it.adresse)}</span>` : ''}${it.infos ? `<div class="muted small">${esc(it.infos)}</div>` : ''}`;
    } else {
      main = `<b>${esc(`${it.marque} ${it.modele}`.trim() || 'Véhicule')}</b>
        ${it.couleur ? `<span class="badge gray">${esc(it.couleur)}</span>` : ''}
        ${it.plaque ? `<span class="badge navy">${esc(it.plaque)}</span>` : ''}
        ${it.infos ? `<div class="muted small">${esc(it.infos)}</div>` : ''}`;
    }
    const actions = canEdit() ? `<div class="btn-row">
      <button class="btn sm ghost" data-act="edit-item" data-kind="${kind}" data-id="${esc(it.id)}">Modifier</button>
      <button class="btn sm ghost" data-act="del-item" data-kind="${kind}" data-id="${esc(it.id)}">Supprimer</button></div>` : '';
    return `<div class="list-item"><div>${main}</div>${actions}</div>`;
  };

  const listCard = (kind, title) => {
    const cfg = KINDS[kind];
    const rows = full[cfg.key];
    return `<div class="card">
      <div class="card-head"><h2>${esc(title)}</h2>${canEdit() ? `<button class="btn sm" data-act="add-item" data-kind="${kind}">+ Ajouter un ${cfg.label}</button>` : ''}</div>
      ${rows.length ? rows.map((r) => itemLine(kind, r)).join('') : `<div class="muted">Aucun ${cfg.label}.</div>`}
    </div>`;
  };

  const fileCard = (f) => {
    const url = urls.get(f.path);
    const isImg = (f.mime_type || '').startsWith('image/');
    const thumb = isImg && url
      ? `<div class="thumb" style="background-image:url('${esc(url)}')" data-act="img" data-id="${esc(f.id)}"></div>`
      : `<div class="thumb" data-act="open-file" data-id="${esc(f.id)}">📄</div>`;
    return `<div class="file-card">${thumb}<div class="meta">
      <b title="${esc(f.file_name)}">${esc(f.file_name)}</b>
      <span class="muted">${esc(f.uploaded_by_name || '')} · ${esc(fmtDT(f.created_at))}</span>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn sm ghost" data-act="open-file" data-id="${esc(f.id)}">Ouvrir</button>
        <button class="btn sm ghost" data-act="dl-file" data-id="${esc(f.id)}" title="Télécharger">⬇</button></div>
    </div></div>`;
  };

  async function draw() {
    if (chatCleanup) { chatCleanup(); chatCleanup = null; }
    const m = full.mandate;

    if (isConv) {
      view.innerHTML = `${head()}<div id="chatBox"></div>`;
      if (!canChat()) {
        view.querySelector('#chatBox').innerHTML = `<div class="card empty">Vous n'avez pas accès à cette conversation. Demandez à un chef de vous ajouter au dossier.</div>`;
        return;
      }
      chatCleanup = await mountChat(view.querySelector('#chatBox'), m, { canManage: canEdit(), onRead: ctx.refreshNav });
      return;
    }

    let hist = [];
    files = [];
    urls = new Map();
    const showAudit = canChat() || can.history();
    if (showAudit) {
      const { data } = await sb.from('mandate_history').select('*').eq('mandate_id', id)
        .order('created_at', { ascending: false }).limit(100);
      hist = data || [];
    }
    if (canChat()) {
      files = full.files;
      urls = await signedUrls(files.map((f) => f.path));
    }

    const decision = m.status === 'en_attente'
      ? '<span class="muted">En attente de validation du maire</span>'
      : `${esc(m.decided_by_name || '—')} · ${esc(fmtDT(m.decided_at))}`;

    const members = full.members.map((r) => state.profiles.get(r.user_id)).filter(Boolean);

    view.innerHTML = `${head()}
      <div class="grid cols2">
        <div class="card"><h2>Décision</h2>${kv([
          ['Statut', statusBadge(m.status)],
          ['Service demandeur', serviceBadge(m.service)],
          ['Chef demandeur', esc(m.requester_name)],
          ['Demande créée le', esc(fmtDT(m.created_at))],
          [m.status === 'refuse' ? 'Refusé par' : 'Validé par', m.status === 'en_attente' ? '' : decision],
          ...(m.status === 'refuse' ? [['Motif du refus', esc(m.refusal_reason || 'Non précisé')]] : []),
        ])}</div>
        <div class="card"><h2>Personne concernée</h2>${kv([
          ['Prénom', esc(m.person_first)],
          ['Nom', esc(m.person_last)],
          ['Informations', esc(m.person_info)],
        ])}</div>
      </div>
      ${listCard('complice', 'Complices')}
      ${listCard('terrain', 'Terrains')}
      ${listCard('vehicle', 'Véhicules')}
      <div class="card"><h2>Informations du mandat</h2>${kv([
        ['Agents concernés', esc(m.agents_concernes)],
        ['Motif', esc(m.motif)],
        ['Description détaillée', esc(m.description)],
        ['Éléments de preuve', esc(m.preuves)],
        ['Objets recherchés', esc(m.objets_recherches)],
        ['Risques éventuels', esc(m.risques)],
        ['Date souhaitée', m.date_souhaitee ? esc(fmtDate(m.date_souhaitee)) : ''],
        ['Heure souhaitée', m.heure_souhaitee ? esc(String(m.heure_souhaitee).slice(0, 5)) : ''],
        ['Informations complémentaires', esc(m.infos_complementaires)],
      ])}</div>
      <div class="card">
        <div class="card-head"><h2>Agents du dossier</h2>${canEdit() ? '<button class="btn sm" data-act="members">👥 Gérer les agents</button>' : ''}</div>
        ${members.length ? `<div class="chips">${members.map((p) => `<span class="chip">${esc(p.prenom)} ${esc(p.nom)} ${roleBadge(p.role)}</span>`).join('')}</div>`
          : '<div class="muted">Aucun agent ajouté.</div>'}
        <p class="muted small" style="margin-bottom:0">Le maire a toujours accès à tous les dossiers.</p>
      </div>
      ${canChat() ? `<div class="card"><h2>Photos et documents</h2>
        ${files.length ? `<div class="files-grid">${files.map(fileCard).join('')}</div>`
          : '<div class="muted">Aucun fichier. Les fichiers envoyés dans la conversation apparaissent ici.</div>'}</div>` : ''}
      ${showAudit ? `<div class="card"><h2>Historique du dossier</h2>
        ${hist.length ? `<div class="timeline">${hist.map((h) => `
          <div class="tl-item"><div class="when">${esc(fmtDT(h.created_at))}</div>
          <div><span class="who">${esc(h.actor_name || 'Système')}</span> – ${esc(h.message)}</div></div>`).join('')}</div>`
          : '<div class="muted">Aucun événement.</div>'}</div>` : ''}`;
  }

  async function reload() {
    full = await fetchMandateFull(id);
    await draw();
  }

  async function setStatus(status, reason = null) {
    const { error } = await sb.from('mandates').update({ status, refusal_reason: reason }).eq('id', id);
    if (error) throw error;
    await reload();
  }

  function openRefuse() {
    const m = openModal({
      title: `Refuser le mandat #${full.mandate.number}`,
      body: '<label>Motif du refus (facultatif)<textarea id="refReason" rows="4"></textarea></label>',
      footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn bad" id="refOk">Refuser le mandat</button>',
    });
    m.q('#refOk').onclick = (e) => busy(e.currentTarget, async () => {
      try {
        await setStatus('refuse', nn(m.q('#refReason').value));
        m.close();
        toast('Mandat refusé.', 'ok');
      } catch (err) { toast(errMsg(err), 'error'); }
    });
  }

  function openEdit() {
    const m0 = full.mandate;
    const field = ([k, label, req, type]) => {
      let val = m0[k] ?? '';
      if (type === 'time') val = String(val).slice(0, 5);
      if (type === 'textarea') return `<label>${esc(label)}<textarea name="${k}" ${req ? 'required' : ''}>${esc(val)}</textarea></label>`;
      return `<label>${esc(label)}<input type="${type === 'input' ? 'text' : type}" name="${k}" ${req ? 'required' : ''} value="${esc(val)}"></label>`;
    };
    const m = openModal({
      title: `Modifier le mandat #${m0.number}`, wide: true,
      body: `<form id="editForm">
        <div class="grid2">${field(EDIT_FIELDS[0])}${field(EDIT_FIELDS[1])}</div>
        ${EDIT_FIELDS.slice(2, 9).map(field).join('')}
        <div class="grid2">${field(EDIT_FIELDS[9])}${field(EDIT_FIELDS[10])}</div>
        ${field(EDIT_FIELDS[11])}
      </form>`,
      footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn gold" id="editSave">Enregistrer</button>',
    });
    m.q('#editSave').onclick = (e) => busy(e.currentTarget, async () => {
      const form = m.q('#editForm');
      if (!form.reportValidity()) return;
      const payload = {};
      EDIT_FIELDS.forEach(([k, , req]) => {
        const v = form[k].value.trim();
        payload[k] = req ? v : nn(v);
      });
      const { error } = await sb.from('mandates').update(payload).eq('id', id);
      if (error) return toast(errMsg(error), 'error');
      m.close();
      toast('Mandat modifié.', 'ok');
      await reload();
    });
  }

  function openItem(kind, item) {
    const cfg = KINDS[kind];
    const m = openModal({
      title: `${item ? 'Modifier le' : 'Ajouter un'} ${cfg.label}`,
      body: `<form id="itemForm">${cfg.fields.map(([k, label, req]) => `
        <label>${esc(label)}<input name="${k}" ${req ? 'required' : ''} value="${esc(item?.[k] ?? '')}"></label>`).join('')}</form>`,
      footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn gold" id="itemSave">Enregistrer</button>',
    });
    m.q('#itemSave').onclick = (e) => busy(e.currentTarget, async () => {
      const form = m.q('#itemForm');
      if (!form.reportValidity()) return;
      const o = {};
      cfg.fields.forEach(([k, , req]) => {
        const v = form[k].value.trim();
        o[k] = (req || k === 'marque' || k === 'modele') ? v : nn(v);
      });
      if (kind === 'vehicle' && !o.marque && !o.modele && !o.plaque) {
        return toast('Indiquez au moins une marque, un modèle ou une plaque.', 'error');
      }
      const { error } = item
        ? await sb.from(cfg.table).update(o).eq('id', item.id)
        : await sb.from(cfg.table).insert({ mandate_id: id, ...o });
      if (error) return toast(errMsg(error), 'error');
      m.close();
      toast(item ? 'Modification enregistrée.' : 'Ajout enregistré.', 'ok');
      await reload();
    });
  }

  async function deleteMandate() {
    if (!(await confirmBox(`Supprimer définitivement le mandat #${full.mandate.number} et tous ses fichiers ?`, { okLabel: 'Supprimer', danger: true }))) return;
    if (full.files.length) await sb.storage.from('mandate-files').remove(full.files.map((f) => f.path));
    const { error } = await sb.from('mandates').delete().eq('id', id);
    if (error) return toast(errMsg(error), 'error');
    toast('Mandat supprimé.', 'ok');
    location.hash = '#/mandats';
  }

  view.onclick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const kind = el.dataset.kind;
    const fileOf = () => files.find((f) => f.id === el.dataset.id);
    try {
      if (act === 'accept') {
        if (await confirmBox(`Accepter le mandat #${full.mandate.number} ?`, { okLabel: 'Accepter' })) {
          await busy(el, () => setStatus('accepte'));
          toast('Mandat accepté.', 'ok');
        }
      } else if (act === 'refuse') openRefuse();
      else if (act === 'reset') {
        await busy(el, () => setStatus('en_attente'));
        toast('Mandat remis en attente.', 'ok');
      } else if (act === 'pdf') {
        await busy(el, async () => {
          const { downloadMandatePdf } = await import('../pdf.js');
          await downloadMandatePdf(full);
        });
      } else if (act === 'edit') openEdit();
      else if (act === 'delete') await deleteMandate();
      else if (act === 'members') openMembersModal(full.mandate, reload);
      else if (act === 'add-item') openItem(kind, null);
      else if (act === 'edit-item') openItem(kind, full[KINDS[kind].key].find((x) => x.id === el.dataset.id));
      else if (act === 'del-item') {
        if (await confirmBox(`Supprimer ce ${KINDS[kind].label} ?`, { okLabel: 'Supprimer', danger: true })) {
          const { error } = await sb.from(KINDS[kind].table).delete().eq('id', el.dataset.id);
          if (error) throw error;
          toast('Supprimé.', 'ok');
          await reload();
        }
      } else if (act === 'img') {
        const f = fileOf();
        if (f) openImage(urls.get(f.path), f.file_name);
      } else if (act === 'open-file') {
        const f = fileOf();
        if (f) window.open(urls.get(f.path) || await signedUrl(f.path), '_blank', 'noopener');
      } else if (act === 'dl-file') {
        const f = fileOf();
        if (f) {
          const a = document.createElement('a');
          a.href = await signedUrl(f.path, { download: f.file_name });
          a.download = f.file_name;
          document.body.append(a); a.click(); a.remove();
        }
      }
    } catch (err) { toast(errMsg(err), 'error'); }
  };

  await draw();

  if (!isConv) {
    const soon = debounce(() => reload().catch(() => {}), 400);
    const f = `mandate_id=eq.${id}`;
    chan = sb.channel(`mandate-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mandates', filter: `id=eq.${id}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mandate_complices', filter: f }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mandate_terrains', filter: f }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mandate_vehicles', filter: f }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mandate_members', filter: f }, soon)
      .subscribe();
  }

  return () => {
    view.onclick = null;
    if (chatCleanup) chatCleanup();
    if (chan) sb.removeChannel(chan);
  };
}
