import { sb, state, can } from './state.js';
import { esc, fmtDT, ROLE_LABEL } from './lib.js';
import { catBadge } from './announcement-ui.js';
import { icon } from './icons.js';
import { mandatesTable, bindRowLinks, personName } from './data.js';

const countMandates = async (status) => {
  let q = sb.from('mandates').select('id', { count: 'exact', head: true });
  if (status) q = q.eq('status', status);
  const { count } = await q;
  return count || 0;
};

const stat = (ico, n, label, href, cls = '') => `
  <a class="stat ${cls}" href="${href}"><div class="ico">${icon(ico)}</div><div><b>${n}</b><span>${esc(label)}</span></div></a>`;

const notifLink = (n) => {
  if (n.type === 'announcement') return '#/annonces';
  if (n.type === 'signup') return '#/utilisateurs';
  if (n.type === 'contact' || n.type === 'contact_reply') return '#/messages';
  if (!n.mandate_id) return '#/';
  if (n.type === 'message' && can.conversations()) return `#/mandats/${n.mandate_id}/conversation`;
  return `#/mandats/${n.mandate_id}`;
};

const announcementsCard = (list) => `
  <div class="card">
    <div class="card-head"><h2>${icon('megaphone')} Annonces citoyennes</h2><a href="#/annonces">Tout voir</a></div>
    ${list.length ? list.map((a) => `
      <a class="list-item" href="#/annonces" style="color:inherit;text-decoration:none"><div>
        <div style="margin-bottom:4px">${catBadge(a.category)}</div>
        <b>${esc(a.title)}</b>
        <div class="muted small">${esc(a.author_name || 'Mairie')} · ${esc(fmtDT(a.created_at))}</div>
        <div class="small" style="margin-top:4px">${esc((a.body || '').slice(0, 160))}${(a.body || '').length > 160 ? '…' : ''}</div>
      </div>${a.image_url ? `<img src="${esc(a.image_url)}" alt="" style="width:84px;height:56px;object-fit:cover;border-radius:10px;flex:none">` : ''}</a>`).join('')
      : '<div class="empty">Aucune annonce.</div>'}
  </div>`;

export default async function render(view) {
  const me = state.user.id;
  const p = state.profile;

  async function draw() {
    const mayor = can.mayor();
    const force = can.force();
    const showMandates = can.viewMandates();

    const annP = sb.from('announcements').select('id,title,body,category,image_url,author_name,created_at')
      .order('created_at', { ascending: false }).limit(3);

    const hour = new Date().getHours();
    const head = `
      <section class="welcome">
        <div>
          <span class="eyebrow">${hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour'}</span>
          <h1>${esc(p.prenom)} ${esc(p.nom)}</h1>
          <p>${esc(ROLE_LABEL[p.role] || 'Citoyen')} · <span>Portail de ${esc(state.settings.mairie_name)}</span></p>
        </div>
        ${can.createMandate() ? '<a class="btn gold lg" href="#/mandats/nouveau">+ Nouvelle demande de mandat</a>' : ''}
      </section>`;

    if (mayor) {
      const [pending, accepted, refused, closed, ann, latest, hist] = await Promise.all([
        countMandates('en_attente'), countMandates('accepte'), countMandates('refuse'), countMandates('cloture'), annP,
        sb.from('mandates').select('*').order('created_at', { ascending: false }).limit(6),
        sb.from('mandate_history').select('*').order('created_at', { ascending: false }).limit(8),
      ]);
      const profs = [...state.profiles.values()].filter((x) => x.is_active);
      const nbPolice = profs.filter((x) => ['chef_police', 'policier'].includes(x.role)).length;
      const nbGn = profs.filter((x) => ['chef_gendarmerie', 'gendarme'].includes(x.role)).length;
      const nbEmp = profs.filter((x) => x.role === 'employe').length;
      const nbPending = [...state.profiles.values()].filter((x) => !x.role).length;

      view.innerHTML = `${head}
        <div class="group-title">Mandats</div>
        <div class="grid cols4">
          ${stat('hourglass', pending, 'Mandats en attente', '#/mandats?status=en_attente', 'warn')}
          ${stat('checkcircle', accepted, 'Mandats acceptés', '#/mandats?status=accepte', 'ok')}
          ${stat('xcircle', refused, 'Mandats refusés', '#/mandats?status=refuse', 'bad')}
          ${stat('archive', closed, 'Mandats clôturés', '#/mandats?status=cloture')}
        </div>
        <div class="group-title">Équipes</div>
        <div class="grid cols4">
          ${stat('shield', nbPolice, 'Policiers', '#/police')}
          ${stat('badge', nbGn, 'Gendarmes', '#/gendarmerie')}
          ${stat('building', nbEmp, 'Employés de mairie', '#/utilisateurs')}
          ${stat('userplus', nbPending, 'Comptes sans rôle', '#/utilisateurs', nbPending ? 'warn' : '')}
        </div>
        <div class="group-title">Activité</div>
        <div class="grid cols2">
          <div class="card"><div class="card-head"><h2>Dernières demandes</h2><a href="#/mandats">Tout voir</a></div>
            ${mandatesTable(latest.data || [], { empty: 'Aucune demande.' })}</div>
          <div class="card"><div class="card-head"><h2>Dernières activités</h2><a href="#/historique">Historique</a></div>
            ${(hist.data || []).length ? `<div class="timeline">${hist.data.map((h) => `
              <div class="tl-item"><div class="when">${esc(fmtDT(h.created_at))}</div>
              <div><span class="who">${esc(h.actor_name || 'Système')}</span> – ${esc(h.message)}</div></div>`).join('')}</div>`
              : '<div class="empty">Aucune activité.</div>'}</div>
        </div>
        <div class="grid cols2">
          <div class="card"><h2>${icon('bell')} Notifications</h2>
            ${state.notifs.length ? state.notifs.slice(0, 6).map((n) => `
              <a class="list-item" href="${notifLink(n)}" style="color:inherit;text-decoration:none">
                <div><b>${esc(n.title)}</b><div class="muted small">${esc(n.body || '')}</div></div>
                <span class="muted small">${esc(fmtDT(n.created_at))}</span></a>`).join('')
              : '<div class="empty">Aucune notification.</div>'}</div>
          ${announcementsCard(ann.data || [])}
        </div>`;
      bindRowLinks(view);
      return;
    }

    if (force) {
      const memberRows = (await sb.from('mandate_members').select('mandate_id').eq('user_id', me)).data || [];
      const ids = memberRows.map((r) => r.mandate_id);
      const [pendingN, acceptedN, ann, recent, pendingList, mine, msgs] = await Promise.all([
        countMandates('en_attente'), countMandates('accepte'), annP,
        sb.from('mandates').select('*').order('created_at', { ascending: false }).limit(6),
        sb.from('mandates').select('*').eq('status', 'en_attente').order('created_at', { ascending: false }).limit(6),
        ids.length ? sb.from('mandates').select('*').in('id', ids).order('created_at', { ascending: false }).limit(6) : { data: [] },
        ids.length ? sb.from('mandate_messages').select('mandate_id,author_name,body,created_at')
          .in('mandate_id', ids).order('created_at', { ascending: false }).limit(40) : { data: [] },
      ]);
      const mineRows = mine.data || [];
      const byId = new Map(mineRows.map((m) => [m.id, m]));
      const seen = new Set();
      const convs = [];
      (msgs.data || []).forEach((m) => {
        if (seen.has(m.mandate_id) || convs.length >= 5) return;
        seen.add(m.mandate_id);
        convs.push(m);
      });
      const missing = convs.filter((c) => !byId.has(c.mandate_id)).map((c) => c.mandate_id);
      if (missing.length) {
        const { data } = await sb.from('mandates').select('*').in('id', missing);
        (data || []).forEach((m) => byId.set(m.id, m));
      }

      view.innerHTML = `${head}
        <div class="grid cols3">
          ${stat('hourglass', pendingN, 'Mandats en attente', '#/mandats?status=en_attente', 'warn')}
          ${stat('folder', ids.length, 'Mes dossiers', '#/conversations')}
          ${stat('checkcircle', acceptedN, 'Mandats acceptés', '#/mandats?status=accepte', 'ok')}
        </div>
        <div class="grid cols2" style="margin-top:18px">
          <div class="card"><div class="card-head"><h2>Mandats récents</h2><a href="#/mandats">Tout voir</a></div>
            ${mandatesTable(recent.data || [])}</div>
          <div class="card"><div class="card-head"><h2>Mandats en attente</h2></div>
            ${mandatesTable(pendingList.data || [], { empty: 'Aucun mandat en attente.' })}</div>
          <div class="card"><div class="card-head"><h2>Mes dossiers</h2></div>
            ${mandatesTable(mineRows, { empty: "Vous n'êtes ajouté à aucun dossier." })}</div>
          <div class="card"><div class="card-head"><h2>Conversations récentes</h2><a href="#/conversations">Tout voir</a></div>
            ${convs.length ? convs.map((c) => {
              const m = byId.get(c.mandate_id);
              return `<a class="list-item" href="#/mandats/${esc(c.mandate_id)}/conversation" style="color:inherit;text-decoration:none">
                <div><b>#${esc(m?.number || '?')} ${m ? esc(personName(m)) : ''}</b>
                <div class="muted small">${esc(c.author_name || '?')} : ${esc((c.body || '[pièce jointe]').slice(0, 70))}</div></div>
                <span class="muted small">${esc(fmtDT(c.created_at))}</span></a>`;
            }).join('') : '<div class="empty">Aucune conversation.</div>'}</div>
        </div>
        ${announcementsCard(ann.data || [])}`;
      bindRowLinks(view);
      return;
    }

    const ann = await annP;
    let block;
    if (showMandates) {
      const [pendingN, acceptedN, refusedN, recent] = await Promise.all([
        countMandates('en_attente'), countMandates('accepte'), countMandates('refuse'),
        sb.from('mandates').select('*').order('created_at', { ascending: false }).limit(8),
      ]);
      block = `<div class="grid cols3">
          ${stat('hourglass', pendingN, 'Mandats en attente', '#/mandats?status=en_attente', 'warn')}
          ${stat('checkcircle', acceptedN, 'Mandats acceptés', '#/mandats?status=accepte', 'ok')}
          ${stat('xcircle', refusedN, 'Mandats refusés', '#/mandats?status=refuse', 'bad')}
        </div>
        <div class="card" style="margin-top:18px"><div class="card-head"><h2>Mandats récents</h2></div>${mandatesTable(recent.data || [])}</div>`;
    } else if (!p.role) {
      block = `<div class="card"><div class="card-head"><h2>${icon('send')} Contacter le maire</h2></div>
        <p class="muted" style="margin-top:0">Une question, une demande ? Écrivez directement au maire. Les rôles (employé, Police, Gendarmerie) sont attribués par le maire.</p>
        <a class="btn gold" href="#/messages">${icon('send')} Écrire au maire</a></div>`;
    } else {
      block = `<div class="card"><p class="muted" style="margin:0">Vous êtes connecté en tant que ${esc(ROLE_LABEL[p.role] || '')}. Les accès supplémentaires sont attribués par le maire.</p></div>`;
    }
    view.innerHTML = `${head}${block}${announcementsCard(ann.data || [])}`;
    bindRowLinks(view);
  }

  await draw();
  const onNew = () => { draw().catch(() => {}); };
  document.addEventListener('notif:new', onNew);
  return () => document.removeEventListener('notif:new', onNew);
}
