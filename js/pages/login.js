import { sb, state } from '../state.js';
import { esc, loginEmailFrom } from '../lib.js';
import { brandURL } from '../branding.js';

export default function renderLogin(root, { notice = '', onDone }) {
  const name = state.settings.mairie_name || "MAIRIE D'AMBOISE";
  root.innerHTML = `
  <div class="login-split">
    <aside class="login-art">
      <a class="back" href="#/">← Retour à l'accueil</a>
      <div>
        <img class="login-logo" src="${esc(brandURL('logo'))}" alt="Blason">
        <h1>${esc(name)}</h1>
        <p>Espace réservé au maire, aux employés de mairie et aux services de Police et de Gendarmerie.</p>
        <ul class="login-points">
          <li>📁 Demandes et suivi des mandats de perquisition</li>
          <li>💬 Conversations privées par dossier</li>
          <li>📢 Publication des annonces citoyennes</li>
        </ul>
      </div>
      <div class="login-art-foot">Nova Life RP · Portail officiel</div>
    </aside>
    <main class="login-panel">
      <form class="login-form" id="loginForm" autocomplete="on">
        <div class="tricolor"></div>
        <h2>Connexion</h2>
        <p class="sub">Identifiez-vous avec vos informations RP.</p>
        ${notice ? `<div class="err">${esc(notice)}</div>` : ''}
        <div class="err hide" id="loginErr"></div>
        <div class="grid2">
          <label>Prénom RP<input name="prenom" autocomplete="username" required placeholder="Gabin"></label>
          <label>Nom RP<input name="nom" autocomplete="family-name" required placeholder="Muller"></label>
        </div>
        <label>Mot de passe
          <span class="pwd-wrap">
            <input name="password" id="pwd" type="password" autocomplete="current-password" required>
            <button type="button" id="pwdToggle" aria-label="Afficher le mot de passe">👁️</button>
          </span>
        </label>
        <button class="btn gold lg" style="width:100%" id="loginBtn">Se connecter</button>
        <p class="muted small center" style="margin:18px 0 0">Les comptes sont créés par le maire.</p>
      </form>
    </main>
  </div>`;

  const form = root.querySelector('#loginForm');
  const err = root.querySelector('#loginErr');
  const pwd = root.querySelector('#pwd');
  root.querySelector('#pwdToggle').onclick = () => {
    pwd.type = pwd.type === 'password' ? 'text' : 'password';
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.classList.add('hide');
    const f = new FormData(form);
    const btn = root.querySelector('#loginBtn');
    btn.disabled = true;
    btn.textContent = 'Connexion…';
    const { error } = await sb.auth.signInWithPassword({
      email: loginEmailFrom(f.get('prenom'), f.get('nom')),
      password: f.get('password'),
    });
    if (error) {
      err.textContent = 'Identifiants incorrects.';
      err.classList.remove('hide');
      btn.disabled = false;
      btn.textContent = 'Se connecter';
      return;
    }
    await onDone();
  };
}
