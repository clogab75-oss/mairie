import { sb, state, loadProfiles } from './state.js';
import { icon } from './icons.js';
import {
  esc, toast, errMsg, busy, fmtDT, fmtDate, openModal, confirmBox, genPassword,
  ROLE_LABEL, ROLE_SERVICE, ASSIGNABLE_ROLES,
} from './lib.js';

const PERMS = [
  ['mandates', 'Consulter les mandats'],
  ['documents', 'Consulter les documents (autorisations acceptées)'],
  ['history', "Consulter l'historique"],
];

export default async function render(view) {
  let q = '';
  let roleFilter = '';

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Gestion des utilisateurs</h1><p>Les visiteurs peuvent créer un compte : vous validez les inscriptions et attribuez les rôles.</p></div>
      <button class="btn gold" id="newUser">${icon('plus')} Nouvel utilisateur</button>
    </div>
    <div id="pendingBox"></div>
    <div class="card">
      <div class="grid2">
        <label>Recherche<input id="uQ" type="search" placeholder="Prénom ou nom…"></label>
        <label>Rôle<select id="uRole"><option value="">Tous les rôles</option>
          ${['maire', ...ASSIGNABLE_ROLES].map((r) => `<option value="${r}">${esc(ROLE_LABEL[r])}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="card" id="uTable"></div>`;

  const table = view.querySelector('#uTable');

  const pendingBox = view.querySelector('#pendingBox');

  function paintPending() {
    const list = [...state.profiles.values()].filter((p) => !p.role)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (!list.length) { pendingBox.innerHTML = ''; return; }
    pendingBox.innerHTML = `<div class="card pending-card">
      <div class="card-head"><h2>${icon('userplus')} Inscriptions à valider</h2></div>
      ${list.map((p) => `<div class="list-item">
        <div><b>${esc(p.prenom)} ${esc(p.nom)}</b><div class="muted small">Inscrit le ${esc(fmtDT(p.created_at))}</div></div>
        <div class="btn-row">
          <button class="btn sm gold" data-act="edit" data-id="${esc(p.id)}">${icon('check')} Valider et attribuer un rôle</button>
          <button class="btn sm bad" data-act="del" data-id="${esc(p.id)}">${icon('x')} Refuser</button>
        </div></div>`).join('')}
    </div>`;
  }

  function paint() {
    paintPending();
    const t = q.trim().toLowerCase();
    const list = [...state.profiles.values()]
      .filter((p) => p.role)
      .filter((p) => (!roleFilter || p.role === roleFilter) && (!t || `${p.prenom} ${p.nom}`.toLowerCase().includes(t)))
      .sort((a, b) => (a.role === 'maire' ? 0 : 1) - (b.role === 'maire' ? 0 : 1)
        || a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));

    if (!list.length) { table.innerHTML = '<div class="empty">Aucun utilisateur.</div>'; return; }

    table.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Prénom</th><th>Nom</th><th>Rôle</th><th>Service</th><th>Statut</th><th>Créé le</th><th>Dernière connexion</th><th></th></tr></thead>
      <tbody>${list.map((p) => {
        const isMaire = p.role === 'maire';
        const self = p.id === state.user.id;
        return `<tr>
          <td>${esc(p.prenom)}</td><td>${esc(p.nom)}</td>
          <td>${esc(ROLE_LABEL[p.role] || 'Sans rôle')}</td>
          <td>${esc(ROLE_SERVICE[p.role] || '—')}</td>
          <td>${p.is_active ? 'Actif' : '<span class="badge bad">Désactivé</span>'}</td>
          <td>${esc(fmtDate(p.created_at))}</td>
          <td>${esc(fmtDT(p.last_login))}</td>
          <td><div class="btn-row" style="justify-content:flex-end">
            <button class="btn sm ghost" data-act="edit" data-id="${esc(p.id)}">Modifier</button>
            <button class="btn sm ghost" data-act="pwd" data-id="${esc(p.id)}">Mot de passe</button>
            ${isMaire || self ? '' : `<button class="btn sm ghost" data-act="${p.is_active ? 'off' : 'on'}" data-id="${esc(p.id)}">${p.is_active ? 'Désactiver' : 'Réactiver'}</button>
            <button class="btn sm bad" data-act="del" data-id="${esc(p.id)}">Supprimer</button>`}
          </div></td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  async function refresh() {
    await loadProfiles();
    paint();
  }

  const rpc = async (fn, args) => {
    const { error } = await sb.rpc(fn, args);
    if (error) throw error;
  };

  function permsHtml(perms) {
    return PERMS.map(([k, l]) => `<label class="check"><input type="checkbox" data-perm="${k}" ${perms?.[k] ? 'checked' : ''}> ${esc(l)}</label>`).join('');
  }

  function openForm(u) {
    const editing = !!u;
    const isMaire = u?.role === 'maire';
    const roles = isMaire ? ['maire'] : ASSIGNABLE_ROLES;
    const m = openModal({
      title: editing ? (u.role ? `Modifier ${u.prenom} ${u.nom}` : `Valider l'inscription de ${u.prenom} ${u.nom}`) : 'Nouvel utilisateur',
      body: `<form id="uForm" autocomplete="off">
        <div class="grid2">
          <label>Prénom RP<input name="prenom" required value="${esc(u?.prenom || '')}"></label>
          <label>Nom RP<input name="nom" required value="${esc(u?.nom || '')}"></label>
        </div>
        ${editing ? '' : `<label>Mot de passe
          <div class="btn-row" style="flex-wrap:nowrap"><input name="password" type="text" minlength="6" required autocomplete="new-password">
          <button type="button" class="btn sm ghost" id="genPwd" style="white-space:nowrap">Générer</button></div></label>`}
        <label>Rôle<select name="role" ${isMaire ? 'disabled' : ''} ${editing && !u.role ? 'required' : ''}>
          ${editing && !u.role ? '<option value="" selected disabled>Choisir un rôle…</option>' : ''}
          ${roles.map((r) => `<option value="${r}" ${u?.role === r ? 'selected' : ''}>${esc(ROLE_LABEL[r])}</option>`).join('')}</select></label>
        <div id="permBox" class="hide"><div class="muted small" style="margin-bottom:6px">Accès accordés à cet employé de mairie :</div>${permsHtml(u?.permissions)}</div>
      </form>`,
      footer: `<button class="btn ghost" data-close>Annuler</button><button class="btn gold" id="uSave">${editing && !u.role ? 'Valider le compte' : 'Enregistrer'}</button>`,
    });

    const form = m.q('#uForm');
    const syncPerms = () => m.q('#permBox').classList.toggle('hide', form.role.value !== 'employe');
    form.role.addEventListener('change', syncPerms);
    syncPerms();
    m.q('#genPwd')?.addEventListener('click', () => { form.password.value = genPassword(10); });

    m.q('#uSave').onclick = (e) => busy(e.currentTarget, async () => {
      if (!form.reportValidity()) return;
      const role = form.role.value;
      const permissions = {};
      m.qa('[data-perm]').forEach((c) => { permissions[c.dataset.perm] = c.checked; });
      const p_permissions = role === 'employe' ? permissions : {};
      try {
        if (editing) {
          await rpc('admin_update_user', { p_id: u.id, p_prenom: form.prenom.value.trim(), p_nom: form.nom.value.trim(), p_role: role, p_permissions });
          toast(u.role ? 'Compte modifié.' : 'Compte validé.', 'ok');
        } else {
          await rpc('admin_create_user', { p_prenom: form.prenom.value.trim(), p_nom: form.nom.value.trim(), p_password: form.password.value, p_role: role, p_permissions });
          toast('Compte créé.', 'ok');
        }
        m.close();
        await refresh();
      } catch (err) { toast(errMsg(err), 'error'); }
    });
  }

  function openPassword(u) {
    const m = openModal({
      title: `Mot de passe de ${u.prenom} ${u.nom}`,
      body: `<label>Nouveau mot de passe
        <div class="btn-row" style="flex-wrap:nowrap"><input id="newPwd" type="text" minlength="6" autocomplete="new-password">
        <button type="button" class="btn sm ghost" id="genPwd2" style="white-space:nowrap">Générer</button></div></label>`,
      footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn gold" id="pwdSave">Enregistrer</button>',
    });
    m.q('#genPwd2').onclick = () => { m.q('#newPwd').value = genPassword(10); };
    m.q('#pwdSave').onclick = (e) => busy(e.currentTarget, async () => {
      const v = m.q('#newPwd').value;
      if (v.length < 6) return toast('6 caractères minimum.', 'error');
      try {
        await rpc('admin_set_password', { p_id: u.id, p_password: v });
        toast('Mot de passe modifié.', 'ok');
        m.close();
      } catch (err) { toast(errMsg(err), 'error'); }
    });
  }

  view.querySelector('#newUser').onclick = () => openForm(null);
  view.querySelector('#uQ').addEventListener('input', (e) => { q = e.target.value; paint(); });
  view.querySelector('#uRole').addEventListener('change', (e) => { roleFilter = e.target.value; paint(); });

  const onAct = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const u = state.profiles.get(b.dataset.id);
    if (!u) return;
    try {
      if (b.dataset.act === 'edit') openForm(u);
      else if (b.dataset.act === 'pwd') openPassword(u);
      else if (b.dataset.act === 'off' || b.dataset.act === 'on') {
        const on = b.dataset.act === 'on';
        if (!(await confirmBox(`${on ? 'Réactiver' : 'Désactiver'} le compte de ${u.prenom} ${u.nom} ?`, { okLabel: on ? 'Réactiver' : 'Désactiver', danger: !on }))) return;
        await rpc('admin_set_active', { p_id: u.id, p_active: on });
        toast(on ? 'Compte réactivé.' : 'Compte désactivé.', 'ok');
        await refresh();
      } else if (b.dataset.act === 'del') {
        if (!(await confirmBox(`${u.role ? 'Supprimer définitivement le compte' : "Refuser l'inscription"} de ${u.prenom} ${u.nom} ?`, { okLabel: u.role ? 'Supprimer' : 'Refuser', danger: true }))) return;
        await rpc('admin_delete_user', { p_id: u.id });
        toast('Compte supprimé.', 'ok');
        await refresh();
      }
    } catch (err) { toast(errMsg(err), 'error'); }
  };
  table.addEventListener('click', onAct);
  pendingBox.addEventListener('click', onAct);

  paint();
  refresh().catch(() => {});
}
