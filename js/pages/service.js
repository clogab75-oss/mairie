import { sb, state, can } from '../state.js';
import { esc, roleBadge, fmtDT } from '../lib.js';
import { mandatesTable, bindRowLinks } from '../data.js';

const count = async (service, status) => {
  const { count: n } = await sb.from('mandates').select('id', { count: 'exact', head: true })
    .eq('service', service).eq('status', status);
  return n || 0;
};

export default async function render(view, ctx) {
  const service = ctx.service;
  const isPolice = service === 'police';
  const label = isPolice ? 'Police' : 'Gendarmerie';
  const roles = isPolice ? ['chef_police', 'policier'] : ['chef_gendarmerie', 'gendarme'];
  const mayor = can.mayor();

  const agents = [...state.profiles.values()]
    .filter((p) => roles.includes(p.role) && (mayor || p.is_active))
    .sort((a, b) => (a.role.startsWith('chef') ? 0 : 1) - (b.role.startsWith('chef') ? 0 : 1)
      || a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));

  const [pending, accepted, refused, list] = await Promise.all([
    count(service, 'en_attente'), count(service, 'accepte'), count(service, 'refuse'),
    sb.from('mandates').select('*').eq('service', service).order('created_at', { ascending: false }).limit(50),
  ]);

  const myService = state.profile.role === 'chef_police' ? 'police' : state.profile.role === 'chef_gendarmerie' ? 'gendarmerie' : null;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>${isPolice ? '👮' : '🪖'} ${label}</h1><p>Agents du service et mandats demandés.</p></div>
      ${can.createMandate() && myService === service ? '<a class="btn gold" href="#/mandats/nouveau">+ Nouvelle demande de mandat</a>' : ''}
    </div>
    <div class="grid cols3">
      <div class="stat warn"><div class="ico">⏳</div><div><b>${pending}</b><span>En attente</span></div></div>
      <div class="stat ok"><div class="ico">✅</div><div><b>${accepted}</b><span>Acceptés</span></div></div>
      <div class="stat bad"><div class="ico">❌</div><div><b>${refused}</b><span>Refusés</span></div></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h2>Agents (${agents.length})</h2>
      ${agents.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Prénom</th><th>Nom</th><th>Rôle</th>${mayor ? '<th>Statut</th><th>Dernière connexion</th>' : ''}</tr></thead>
        <tbody>${agents.map((p) => `<tr>
          <td>${esc(p.prenom)}</td><td>${esc(p.nom)}</td><td>${roleBadge(p.role)}</td>
          ${mayor ? `<td>${p.is_active ? '<span class="badge ok">Actif</span>' : '<span class="badge bad">Désactivé</span>'}</td><td>${esc(fmtDT(p.last_login))}</td>` : ''}
        </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun agent dans ce service.</div>'}
    </div>
    <div class="card">
      <div class="card-head"><h2>Mandats ${label}</h2><a href="#/mandats?service=${service}">Rechercher</a></div>
      ${mandatesTable(list.data || [], { empty: `Aucun mandat ${label}.` })}
    </div>`;
  bindRowLinks(view);
}
