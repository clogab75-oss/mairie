import { sb } from './state.js';
import { esc, loginEmailFrom, slug } from './lib.js';
import { brandURL } from './branding.js';
import { icon } from './icons.js';

export default function renderSignup(root) {
  root.innerHTML = `
  <div class="login-split">
    <aside class="login-art">
      <a class="back" href="#/">${icon('arrowleft')} Retour à l'accueil</a>
      <div>
        <img class="login-logo" src="${esc(brandURL('logo'))}" alt="Blason">
        <h1>Rejoindre la commune d'Amboise</h1>
        <p>Créez votre compte avec votre identité RP. Le maire validera votre inscription et vous attribuera votre rôle.</p>
        <ul class="login-points">
          <li>${icon('userplus')} Inscription ouverte à tous</li>
          <li>${icon('shield')} Accès activé après validation du maire</li>
          <li>${icon('lock')} Mot de passe chiffré, jamais visible</li>
        </ul>
      </div>
      <img class="art" src="hotel-de-ville.svg" alt="">
      <div class="login-art-foot">Nova Life RP · Portail officiel</div>
    </aside>
    <main class="login-panel">
      <form class="login-form" id="signupForm" autocomplete="on">
        <h2>Créer un compte</h2>
        <p class="sub">Utilisez exactement votre nom RP.</p>
        <div class="err hide" id="signupErr"></div>
        <div class="grid2">
          <label>Prénom RP<input name="prenom" autocomplete="given-name" required maxlength="40" placeholder="Gabin"></label>
          <label>Nom RP<input name="nom" autocomplete="family-name" required maxlength="40" placeholder="Muller"></label>
        </div>
        <label>Mot de passe (6 caractères minimum)
          <span class="pwd-wrap">
            <input name="password" id="pwd" type="password" autocomplete="new-password" required minlength="6">
            <button type="button" id="pwdToggle" aria-label="Afficher le mot de passe">${icon('eye')}</button>
          </span>
        </label>
        <label>Confirmer le mot de passe<input name="confirm" type="password" autocomplete="new-password" required minlength="6"></label>
        <button class="btn gold lg" style="width:100%" id="signupBtn">Créer mon compte</button>
        <p class="muted small center" style="margin:18px 0 0">Déjà un compte ? <a href="#/connexion">Se connecter</a></p>
      </form>
    </main>
  </div>`;

  const form = root.querySelector('#signupForm');
  const err = root.querySelector('#signupErr');
  const pwd = root.querySelector('#pwd');
  const fail = (msg) => { err.textContent = msg; err.classList.remove('hide'); };

  root.querySelector('#pwdToggle').onclick = () => {
    pwd.type = pwd.type === 'password' ? 'text' : 'password';
    root.querySelector('#pwdToggle').innerHTML = icon(pwd.type === 'password' ? 'eye' : 'eyeoff');
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.classList.add('hide');
    const f = new FormData(form);
    const prenom = String(f.get('prenom') || '').trim();
    const nom = String(f.get('nom') || '').trim();
    const password = String(f.get('password') || '');
    if (!slug(prenom) || !slug(nom)) return fail('Prénom ou nom invalide.');
    if (password.length < 6) return fail('Mot de passe : 6 caractères minimum.');
    if (password !== f.get('confirm')) return fail('Les mots de passe ne correspondent pas.');

    const btn = root.querySelector('#signupBtn');
    btn.disabled = true;
    btn.textContent = 'Création…';
    const { error } = await sb.auth.signUp({
      email: loginEmailFrom(prenom, nom),
      password,
      options: { data: { prenom, nom } },
    });
    if (error) {
      btn.disabled = false;
      btn.textContent = 'Créer mon compte';
      const msg = String(error.message || '');
      if (/already|registered|database error/i.test(msg)) return fail('Un compte existe déjà pour ce nom.');
      if (/signups? (are )?(not allowed|disabled)/i.test(msg)) return fail("Les inscriptions sont fermées pour le moment.");
      return fail("Impossible de créer le compte. Réessayez dans un instant.");
    }
    await sb.auth.signOut();
    root.querySelector('.login-form').innerHTML = `
      <div class="done-icon">${icon('checkcircle')}</div>
      <h2>Compte créé</h2>
      <p class="sub">Bienvenue ${esc(prenom)}. Le maire doit maintenant valider votre compte et vous attribuer un rôle. Vous pourrez ensuite vous connecter avec votre prénom, votre nom et votre mot de passe.</p>
      <a class="btn gold lg" style="width:100%" href="#/connexion">Aller à la connexion</a>`;
  };
}
