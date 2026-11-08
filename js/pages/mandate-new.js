import { sb, state } from '../state.js';
import { esc, toast, errMsg, busy, nn, ROLE_LABEL } from '../lib.js';
import { eligibleMembers, MEMBER_GROUPS } from '../data.js';

const complice = () => `
  <div class="row-card" data-row="complice">
    <div class="grid2">
      <label>Prénom<input data-f="prenom" required></label>
      <label>Nom<input data-f="nom" required></label>
    </div>
    <label>Informations complémentaires<input data-f="infos"></label>
    <button type="button" class="btn sm ghost" data-rm>Retirer ce complice</button>
  </div>`;

const terrain = () => `
  <div class="row-card" data-row="terrain">
    <div class="grid2">
      <label>Numéro du terrain<input data-f="numero" required placeholder="152"></label>
      <label>Adresse / localisation<input data-f="adresse"></label>
    </div>
    <label>Informations supplémentaires<input data-f="infos"></label>
    <button type="button" class="btn sm ghost" data-rm>Retirer ce terrain</button>
  </div>`;

const vehicle = () => `
  <div class="row-card" data-row="vehicle">
    <div class="grid3">
      <label>Marque<input data-f="marque" placeholder="Peugeot"></label>
      <label>Modèle<input data-f="modele" placeholder="206"></label>
      <label>Couleur<input data-f="couleur"></label>
    </div>
    <div class="grid2">
      <label>Plaque<input data-f="plaque" placeholder="AB-123-CD"></label>
      <label>Informations supplémentaires<input data-f="infos"></label>
    </div>
    <button type="button" class="btn sm ghost" data-rm>Retirer ce véhicule</button>
  </div>`;

const collect = (root, kind) => [...root.querySelectorAll(`[data-row="${kind}"]`)].map((row) => {
  const o = {};
  row.querySelectorAll('[data-f]').forEach((i) => { o[i.dataset.f] = i.value.trim(); });
  return o;
});

export default async function render(view) {
  const me = state.user.id;
  const role = state.profile.role;
  const service = role === 'chef_police' ? 'police' : 'gendarmerie';
  const serviceLabel = service === 'police' ? 'Police' : 'Gendarmerie';
  const profs = eligibleMembers().filter((p) => p.id !== me);

  const picker = MEMBER_GROUPS.map(([title, roles]) => {
    const list = profs.filter((p) => roles.includes(p.role));
    if (!list.length) return '';
    return `<div class="group">${esc(title)}</div>${list.map((p) => `
      <label class="check" data-name="${esc((p.prenom + ' ' + p.nom).toLowerCase())}">
        <input type="checkbox" name="member" value="${esc(p.id)}">
        ${esc(p.prenom)} ${esc(p.nom)} <span class="badge gray">${esc(ROLE_LABEL[p.role])}</span>
      </label>`).join('')}`;
  }).join('') || '<div class="empty">Aucun autre agent disponible.</div>';

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Nouvelle demande de mandat</h1><p>La demande sera envoyée au maire pour validation.</p></div>
    </div>
    <form id="mandForm">
      <div class="card">
        <h2>Personne concernée</h2>
        <div class="grid2">
          <label>Prénom<input name="person_first" required></label>
          <label>Nom<input name="person_last" required></label>
        </div>
        <label>Informations complémentaires<textarea name="person_info"></textarea></label>
      </div>

      <div class="card">
        <div class="card-head"><h2>Complices</h2><button type="button" class="btn sm" id="addComplice">+ Ajouter un complice</button></div>
        <div id="complices"></div>
        <p class="muted small" id="complicesEmpty" style="margin:0">Aucun complice.</p>
      </div>

      <div class="card">
        <div class="card-head"><h2>Terrains</h2><button type="button" class="btn sm" id="addTerrain">+ Ajouter un terrain</button></div>
        <div id="terrains"></div>
        <p class="muted small" id="terrainsEmpty" style="margin:0">Aucun terrain.</p>
      </div>

      <div class="card">
        <div class="card-head"><h2>Véhicules</h2><button type="button" class="btn sm" id="addVehicle">+ Ajouter un véhicule</button></div>
        <div id="vehicles"></div>
        <p class="muted small" id="vehiclesEmpty" style="margin:0">Aucun véhicule.</p>
      </div>

      <div class="card">
        <h2>Informations du mandat</h2>
        <div class="grid2">
          <label>Service demandeur<input value="${esc(serviceLabel)}" disabled></label>
          <label>Chef demandeur<input value="${esc(state.profile.prenom + ' ' + state.profile.nom)}" disabled></label>
        </div>
        <label>Agents concernés<textarea name="agents_concernes" placeholder="Noms des agents qui interviendront"></textarea></label>
        <label>Motif de la perquisition<textarea name="motif" required></textarea></label>
        <label>Description détaillée<textarea name="description"></textarea></label>
        <label>Éléments de preuve<textarea name="preuves"></textarea></label>
        <label>Objets recherchés<textarea name="objets_recherches"></textarea></label>
        <label>Risques éventuels<textarea name="risques"></textarea></label>
        <div class="grid2">
          <label>Date souhaitée<input type="date" name="date_souhaitee"></label>
          <label>Heure souhaitée<input type="time" name="heure_souhaitee"></label>
        </div>
        <label>Informations complémentaires<textarea name="infos_complementaires"></textarea></label>
      </div>

      <div class="card">
        <h2>Agents ayant accès au dossier</h2>
        <p class="muted small" style="margin-top:0">Les agents cochés (Police et Gendarmerie) pourront ouvrir le dossier et participer à la conversation. Vous y êtes ajouté automatiquement et le maire y a toujours accès.</p>
        <input id="memFilter" type="search" placeholder="Filtrer par nom…" style="margin-bottom:10px">
        <div class="pick">${picker}</div>
      </div>

      <div class="btn-row">
        <button class="btn gold" id="sendBtn" type="submit">Envoyer la demande</button>
        <a class="btn ghost" href="#/mandats">Annuler</a>
      </div>
    </form>`;

  const form = view.querySelector('#mandForm');
  const lists = { complice: view.querySelector('#complices'), terrain: view.querySelector('#terrains'), vehicle: view.querySelector('#vehicles') };
  const empties = { complice: view.querySelector('#complicesEmpty'), terrain: view.querySelector('#terrainsEmpty'), vehicle: view.querySelector('#vehiclesEmpty') };
  const templates = { complice, terrain, vehicle };

  const syncEmpty = () => {
    Object.keys(lists).forEach((k) => empties[k].classList.toggle('hide', lists[k].children.length > 0));
  };

  const adders = { addComplice: 'complice', addTerrain: 'terrain', addVehicle: 'vehicle' };
  Object.entries(adders).forEach(([id, kind]) => {
    view.querySelector(`#${id}`).onclick = () => {
      lists[kind].insertAdjacentHTML('beforeend', templates[kind]());
      lists[kind].lastElementChild.querySelector('input')?.focus();
      syncEmpty();
    };
  });

  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { b.closest('.row-card').remove(); syncEmpty(); }
  });

  view.querySelector('#memFilter').oninput = (e) => {
    const t = e.target.value.trim().toLowerCase();
    form.querySelectorAll('label.check').forEach((l) => l.classList.toggle('hide', !!t && !l.dataset.name.includes(t)));
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const complices = collect(form, 'complice');
    const terrains = collect(form, 'terrain');
    const vehicles = collect(form, 'vehicle');
    if (vehicles.some((v) => !v.marque && !v.modele && !v.plaque)) {
      return toast('Chaque véhicule doit avoir au moins une marque, un modèle ou une plaque.', 'error');
    }
    const fd = new FormData(form);
    const g = (k) => nn(fd.get(k));
    const payload = {
      service,
      created_by: me,
      person_first: String(fd.get('person_first')).trim(),
      person_last: String(fd.get('person_last')).trim(),
      person_info: g('person_info'),
      agents_concernes: g('agents_concernes'),
      motif: String(fd.get('motif')).trim(),
      description: g('description'),
      preuves: g('preuves'),
      objets_recherches: g('objets_recherches'),
      risques: g('risques'),
      date_souhaitee: g('date_souhaitee'),
      heure_souhaitee: g('heure_souhaitee'),
      infos_complementaires: g('infos_complementaires'),
    };
    const memberIds = fd.getAll('member');

    await busy(view.querySelector('#sendBtn'), async () => {
      const { data: m, error } = await sb.from('mandates').insert(payload).select().single();
      if (error) return toast(errMsg(error), 'error');

      const jobs = [];
      if (complices.length) jobs.push(sb.from('mandate_complices').insert(complices.map((c) => ({ mandate_id: m.id, prenom: c.prenom, nom: c.nom, infos: nn(c.infos) }))));
      if (terrains.length) jobs.push(sb.from('mandate_terrains').insert(terrains.map((t) => ({ mandate_id: m.id, numero: t.numero, adresse: nn(t.adresse), infos: nn(t.infos) }))));
      if (vehicles.length) jobs.push(sb.from('mandate_vehicles').insert(vehicles.map((v) => ({ mandate_id: m.id, marque: v.marque, modele: v.modele, couleur: nn(v.couleur), plaque: nn(v.plaque), infos: nn(v.infos) }))));
      if (memberIds.length) jobs.push(sb.from('mandate_members').insert(memberIds.map((user_id) => ({ mandate_id: m.id, user_id }))));

      const results = await Promise.all(jobs);
      const failed = results.find((r) => r.error);
      if (failed) toast(`Mandat #${m.number} créé, mais une partie des données n'a pas été enregistrée : ${errMsg(failed.error)}`, 'error');
      else toast(`Demande #${m.number} envoyée au maire.`, 'ok');
      location.hash = `#/mandats/${m.id}`;
    });
  };
}
