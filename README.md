# Portail administratif – Mairie d'Amboise (Nova Life RP)

Site web de gestion administrative pour la Mairie d'Amboise : mandats et perquisitions, conversations privées par dossier, annonces, historique, PDF officiel et notifications Discord.

- Hébergement : GitHub Pages (site statique, aucun serveur à payer)
- Base de données, comptes, fichiers et temps réel : Supabase
- Notifications : webhook Discord

## Contenu du dépôt

```
index.html
.nojekyll
.gitignore
.env.example
assets/        logo.svg, stamp.svg, signature.svg
css/           style.css
js/            app.js, config.js, lib.js, state.js, branding.js, data.js, chat.js, pdf.js
js/pages/      login, dashboard, announcements, mandates, mandate-new, mandate-detail,
               conversations, service, documents, history, users, settings
supabase/      01_schema.sql, 02_security.sql, 03_automation.sql, 04_storage.sql, 05_seed_maire.sql
```

## 1. Créer le projet Supabase

1. Créez un compte sur https://supabase.com puis cliquez sur **New project**.
2. Choisissez un nom (par exemple `mairie-amboise`), un mot de passe de base de données (à conserver) et la région la plus proche (Europe).
3. Attendez la fin de la création du projet (1 à 2 minutes).
4. Dans **Project Settings → API Keys**, notez :
   - l'**URL du projet** (`https://xxxx.supabase.co`)
   - la clé **publishable** (`sb_publishable_…`)

La clé publishable est faite pour être publique : la sécurité repose sur les règles RLS de la base. Ne copiez jamais la clé `service_role` ou `secret` dans le site.

## 2. Créer la base

Ouvrez **SQL Editor** dans Supabase. Vous allez y coller les fichiers du dossier `supabase/` un par un, dans l'ordre, en cliquant sur **Run** après chaque fichier.

## 3. Exécuter le SQL

Exécutez dans cet ordre exact :

| Ordre | Fichier | Rôle |
|---|---|---|
| 1 | `01_schema.sql` | Tables, index de recherche, réglages par défaut |
| 2 | `02_security.sql` | Fonctions de droits, règles RLS, gestion des comptes |
| 3 | `03_automation.sql` | Historique automatique, notifications, Discord, annonces |
| 4 | `04_storage.sql` | Dossiers de stockage, droits sur les fichiers, temps réel |

Chaque fichier peut être relancé sans danger. Si une erreur apparaît à l'étape 1 à propos de `pg_net`, activez l'extension dans **Database → Extensions** (recherchez `pg_net`), puis relancez le fichier.

## 4. Vérifier les RLS

Les règles RLS sont créées par `02_security.sql`. Pour vérifier : **Authentication → Policies**. Toutes les tables du schéma `public` doivent afficher *RLS enabled* avec leurs règles.

Principe de sécurité : les droits sont contrôlés par la base de données, pas seulement par le JavaScript.

- Un utilisateur ne peut pas modifier son propre rôle (aucune règle d'écriture sur les profils, seules des fonctions réservées au maire modifient les comptes).
- Seuls les chefs Police et Gendarmerie créent des demandes de mandat.
- Seul le maire accepte ou refuse un mandat.
- Police et Gendarmerie voient les mandats des deux services.
- Les conversations et leurs fichiers sont réservés aux agents ajoutés au dossier et au maire.

## 5. Créer les Storage Buckets

`04_storage.sql` crée automatiquement trois buckets. Vérifiez dans **Storage** :

| Bucket | Visibilité | Usage |
|---|---|---|
| `mandate-files` | privé | photos et PDF des conversations (10 Mo maximum) |
| `branding` | public | logo, tampon, signature personnalisés |
| `announcements` | public | images des annonces (5 Mo maximum) |

Le bucket des annonces est public pour que Discord puisse afficher l'image dans le message.

## 6. Configurer l'authentification

Dans **Authentication → Sign In / Providers** :

1. Laissez le fournisseur **Email** activé (il sert d'identifiant interne).
2. Désactivez **Allow new users to sign up** : seuls les comptes créés par le maire doivent exister.

Les utilisateurs se connectent avec leur prénom, leur nom et leur mot de passe. En interne, le site convertit `Gabin` + `Muller` en identifiant `gabin.muller@amboise-rp.fr`. Cet identifiant n'est jamais affiché et aucun e-mail n'est envoyé. Les mots de passe sont chiffrés par Supabase, jamais stockés en clair.

## 7. Configurer le projet

Ouvrez `js/config.js` et remplacez les deux valeurs :

```js
export const SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_VOTRE_CLE';
export const LOGIN_DOMAIN = 'amboise-rp.fr';
```

`LOGIN_DOMAIN` doit rester identique à la valeur renvoyée par la fonction SQL `login_domain()` dans `02_security.sql`. Ne le changez que si vous modifiez aussi cette fonction.

Le fichier `.env.example` rappelle simplement les valeurs à renseigner. Le site étant statique, c'est `js/config.js` qui est lu.

## 8. Configurer le webhook Discord

1. Dans Discord, ouvrez les paramètres du salon voulu → **Intégrations → Webhooks → Nouveau webhook**.
2. Copiez l'URL du webhook.
3. Sur le site, connectez-vous en tant que maire → **Paramètres → Discord**, collez l'URL, cochez les notifications souhaitées et cliquez sur **Enregistrer**.
4. Cliquez sur **Envoyer un message de test**.

L'URL du webhook est enregistrée dans une table lisible uniquement par le maire. Elle n'apparaît jamais dans le code public du site, et ce sont des déclencheurs côté base de données qui appellent Discord.

Messages envoyés :

- nouvelle demande de mandat
- mandat accepté
- mandat refusé (avec le motif)
- nouveau message dans un dossier (auteur et numéro de mandat, sans le contenu par défaut)
- nouvelle annonce (titre, texte et image)

## 9. Créer le compte de Gabin Muller

1. Ouvrez `supabase/05_seed_maire.sql`.
2. Remplacez `CHANGEZ-MOI-123` par le vrai mot de passe du maire.
3. Exécutez le fichier une seule fois dans le SQL Editor.
4. Le résultat doit afficher une ligne : Gabin Muller, rôle `maire`, actif.

Connectez-vous ensuite avec Prénom `Gabin`, Nom `Muller` et ce mot de passe. Depuis **Utilisateurs**, le maire crée ensuite tous les autres comptes (employés, chefs, policiers, gendarmes), sans limite par rôle.

Le mot de passe saisi dans le fichier SQL ne doit pas être envoyé sur GitHub : remettez le texte d'origine avant de publier le dépôt.

## 10. Déployer sur GitHub Pages

1. Créez un dépôt GitHub (par exemple `mairie-amboise`) et envoyez-y tous les fichiers de ce projet, y compris `.nojekyll`.
2. Dans le dépôt : **Settings → Pages**.
3. Source : **Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
4. Après une minute, le site est disponible à l'adresse `https://VOTRE-PSEUDO.github.io/mairie-amboise/`.

Le site utilise des adresses du type `#/mandats`, ce qui est compatible avec GitHub Pages sans configuration supplémentaire.

## Utilisation

- **Mandats** : un chef Police ou Gendarmerie crée la demande, choisit les agents (Police et Gendarmerie) qui auront accès au dossier et à sa conversation, puis le maire accepte ou refuse. Un mandat accepté reste modifiable, chaque changement est enregistré dans l'historique.
- **Conversation** : messages en temps réel, photos JPG, PNG, WEBP et PDF, aperçu, téléchargement, statut de lecture.
- **PDF** : le bouton *Télécharger l'autorisation de perquisition* apparaît sur un mandat accepté.
- **Annonces** : le maire publie une annonce (titre, texte, image facultative). Elle apparaît sur le site pour tous les comptes et part sur Discord. Les images se choisissent depuis le formulaire.
- **Employés de mairie** : le maire choisit les accès de chaque employé (mandats, documents, historique) à la création ou à la modification du compte.
- **Paramètres** : nom de la mairie et du maire, logo, tampon, signature, webhook Discord, numérotation des mandats, textes du PDF.

## Dépannage

| Problème | Solution |
|---|---|
| « Identifiants incorrects » | Vérifiez l'orthographe du prénom et du nom (les accents et majuscules sont ignorés) et que `LOGIN_DOMAIN` est identique côté site et côté SQL |
| Page blanche | Ouvrez la console du navigateur (F12) et vérifiez les valeurs de `js/config.js` |
| Aucun message Discord | Utilisez le bouton de test, vérifiez l'URL du webhook et que l'extension `pg_net` est activée |
| Messages non reçus en temps réel | Relancez `04_storage.sql` (il active Realtime sur les tables concernées) |
| Image d'annonce absente dans Discord | Le bucket `announcements` doit être public (créé par `04_storage.sql`) |
