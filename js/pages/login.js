import { sb } from '../state.js';
import { esc, loginEmailFrom } from '../lib.js';

export default function renderLogin(root, { notice = '', onDone }) {
  root.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="loginForm" autocomplete="on">
      <img src="assets/logo.svg" alt="Logo de la Mairie d'Amboise">
      <h1>Mairie d'Amboise</h1>
      <p class="sub">Portail administratif – Nova Life RP</p>
      <div class="tricolor"></div>
      ${notice ? `<div class="err">${esc(notice)}</div>` : ''}
      <div class="err hide" id="loginErr"></div>
      <label>Prénom RP<input name="prenom" autocomplete="username" required placeholder="Gabin"></label>
      <label>Nom RP<input name="nom" autocomplete="family-name" required placeholder="Muller"></label>
      <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn gold" style="width:100%;justify-content:center;margin-top:6px" id="loginBtn">Se connecter</button>
      <p class="muted small center" style="margin:16px 0 0">Les comptes sont créés par le maire.</p>
    </form>
  </div>`;

  const form = root.querySelector('#loginForm');
  const err = root.querySelector('#loginErr');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.classList.add('hide');
    const f = new FormData(form);
    const btn = root.querySelector('#loginBtn');
    btn.disabled = true; btn.textContent = 'Connexion…';
    const { error } = await sb.auth.signInWithPassword({
      email: loginEmailFrom(f.get('prenom'), f.get('nom')),
      password: f.get('password'),
    });
    if (error) {
      err.textContent = 'Identifiants incorrects.';
      err.classList.remove('hide');
      btn.disabled = false; btn.textContent = 'Se connecter';
      return;
    }
    await onDone();
  };
}
