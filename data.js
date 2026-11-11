import { sb, state } from './state.js';
import { esc, statusBadge, serviceBadge, fmtDT, MEMBER_ROLES } from './lib.js';

export const personName = (m) => `${m.person_first} ${m.person_last}`;

export async function searchMandates(f = {}) {
  const { data, error } = await sb.rpc('search_mandates', {
    p_q: f.q || null,
    p_service: f.service || null,
    p_status: f.status || null,
    p_from: f.from || null,
    p_to: f.to || null,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchMandateFull(id) {
  const { data: mandate, error } = await sb.from('mandates').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!mandate) throw new Error('Mandat introuvable ou accès refusé.');
  const soft = async (q) => { const { data } = await q; return data || []; };
  const [complices, terrains, vehicles, members, files] = await Promise.all([
    soft(sb.from('mandate_complices').select('*').eq('mandate_id', id).order('created_at')),
    soft(sb.from('mandate_terrains').select('*').eq('mandate_id', id).order('created_at')),
    soft(sb.from('mandate_vehicles').select('*').eq('mandate_id', id).order('created_at')),
    soft(sb.from('mandate_members').select('*').eq('mandate_id', id).order('created_at')),
    soft(sb.from('mandate_files').select('*').eq('mandate_id', id).order('created_at', { ascending: false })),
  ]);
  return { mandate, complices, terrains, vehicles, members, files };
}

export function mandatesTable(rows, { empty = 'Aucun mandat.' } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>N°</th><th>Personne</th><th>Service</th><th>Demandeur</th><th>Statut</th><th>Créé le</th></tr></thead>
    <tbody>${rows.map((m) => `
      <tr class="click" data-href="#/mandats/${esc(m.id)}">
        <td><b>#${esc(m.number)}</b></td>
        <td>${esc(personName(m))}</td>
        <td>${serviceBadge(m.service)}</td>
        <td>${esc(m.requester_name || '—')}</td>
        <td>${statusBadge(m.status)}</td>
        <td>${esc(fmtDT(m.created_at))}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

export function bindRowLinks(root) {
  root.querySelectorAll('tr.click[data-href]').forEach((tr) => {
    tr.onclick = () => { location.hash = tr.dataset.href; };
  });
}

export function eligibleMembers() {
  return [...state.profiles.values()]
    .filter((p) => p.is_active && MEMBER_ROLES.includes(p.role))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));
}

export const MEMBER_GROUPS = [
  ['Maire', ['maire']],
  ['Police', ['chef_police', 'policier']],
  ['Gendarmerie', ['chef_gendarmerie', 'gendarme']],
];
