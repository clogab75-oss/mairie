import { sb, state, loadSettings } from '../state.js';
import { esc, toast, errMsg, busy, confirmBox } from '../lib.js';
import { brandURL } from '../branding.js';

const IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const IMAGES = [['logo', 'Logo'], ['stamp', 'Tampon'], ['signature', 'Signature du maire']];
const TOGGLES = [
  ['notify_new', 'Nouvelle demande de mandat'],
  ['notify_decision', 'Mandat accepté ou refusé'],
  ['notify_message', 'Nouveau message dans un dossier'],
  ['notify_announcement', 'Publier les annonces citoyennes sur Discord'],
  ['discord_message_preview', 'Afficher un aperçu du message dans Discord (déconseillé)'],
];

export default async function render(view) {
  const me = state.user.id;
  const { data: whs } = await sb.from('private_settings').select('key,value').in('key', ['discord_webhook', 'discord_webhook_announcements']);
  const hooks = Object.fromEntries((whs || []).map((r) => [r.key, r.value || '']));
  const webhook = hooks.discord_webhook || '';
  const webhookAnn = hooks.discord_webhook_announcements || '';
  const HOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//;

  const draw = () => {
    const s = state.settings;
    view.innerHTML = `
      <div class="page-head"><div><h1>Paramètres</h1><p>Configuration de la mairie, des documents et de Discord.</p></div></div>

      <form class="card" id="infoForm">
        <h2>Identité et documents PDF</h2>
        <div class="grid3">
          <label>Nom de la mairie<input name="mairie_name" value="${esc(s.mairie_name)}" required></label>
          <label>Nom du maire<input name="maire_name" value="${esc(s.maire_name)}" required></label>
          <label>Titre du maire<input name="maire_title" value="${esc(s.maire_title)}" required></label>
        </div>
        <div class="grid3">
          <label>Ville (PDF)<input name="pdf_city" value="${esc(s.pdf_city)}"></label>
          <label>Ligne sous le titre (PDF)<input name="pdf_extra" value="${esc(s.pdf_extra)}"></label>
          <label>Pied de page (PDF)<input name="pdf_footer" value="${esc(s.pdf_footer)}"></label>
        </div>
        <h3 style="margin:8px 0 10px">Numérotation des mandats</h3>
        <div class="grid3">
          <label>Préfixe (facultatif)<input name="number_prefix" value="${esc(s.number_prefix || '')}" maxlength="10"></label>
          <label>Nombre de chiffres<select name="number_pad">
            ${[3, 4, 5, 6].map((n) => `<option value="${n}" ${Number(s.number_pad) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Exemple<input id="numPreview" disabled></label>
        </div>
        <button class="btn gold" type="submit">Enregistrer</button>
      </form>

      <div class="card">
        <h2>Logo, tampon et signature</h2>
        <p class="muted small" style="margin-top:0">Images utilisées sur le site et sur les PDF (PNG, JPG ou WEBP, 2 Mo maximum, fond transparent conseillé pour le tampon et la signature).</p>
        <div class="grid3">${IMAGES.map(([k, label]) => `
          <div class="row-card" style="text-align:center">
            <b>${esc(label)}</b>
            <div style="height:130px;display:grid;place-items:center;margin:8px 0;background:#fff;border-radius:8px">
              <img src="${esc(brandURL(k))}" alt="${esc(label)}" style="max-width:100%;max-height:120px"></div>
            <input type="file" data-img="${k}" accept="image/png,image/jpeg,image/webp">
            ${s[`${k}_path`] ? `<button type="button" class="btn sm ghost" data-reset="${k}" style="margin-top:8px">Revenir à l'image par défaut</button>` : ''}
          </div>`).join('')}</div>
      </div>

      <form class="card" id="discordForm">
        <h2>Discord</h2>
        <label>Webhook des notifications (mandats, décisions, messages)
          <input name="webhook" type="text" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" value="${esc(webhook)}"></label>
        <label>Webhook des annonces citoyennes
          <input name="webhookAnn" type="text" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" value="${esc(webhookAnn)}"></label>
        <p class="muted small" style="margin-top:-6px">Utilisez deux salons différents : les annonces ne sont jamais envoyées dans le salon des notifications. Ces adresses ne sont visibles que par le maire.</p>
        <div style="margin:8px 0 14px">${TOGGLES.map(([k, l]) => `
          <label class="check"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
        <div class="btn-row">
          <button class="btn gold" type="submit">Enregistrer</button>
          <button class="btn ghost" type="button" id="testDiscord">Tester les notifications</button>
          <button class="btn ghost" type="button" id="testDiscordAnn">Tester les annonces</button>
        </div>
      </form>`;

    const info = view.querySelector('#infoForm');
    const preview = () => {
      const pad = Number(info.number_pad.value);
      view.querySelector('#numPreview').value = `#${info.number_prefix.value}${new Date().getFullYear()}-${'1'.padStart(pad, '0')}`;
    };
    info.number_prefix.addEventListener('input', preview);
    info.number_pad.addEventListener('change', preview);
    preview();

    info.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(info);
      const rows = ['mairie_name', 'maire_name', 'maire_title', 'pdf_city', 'pdf_extra', 'pdf_footer', 'number_prefix']
        .map((key) => ({ key, value: String(fd.get(key) ?? '').trim(), updated_by: me }));
      rows.push({ key: 'number_pad', value: Number(fd.get('number_pad')), updated_by: me });
      await busy(info.querySelector('button[type=submit]'), async () => {
        const { error } = await sb.from('settings').upsert(rows, { onConflict: 'key' });
        if (error) return toast(errMsg(error), 'error');
        await loadSettings();
        applyBrand();
        toast('Paramètres enregistrés.', 'ok');
      });
    };

    const discord = view.querySelector('#discordForm');
    discord.onsubmit = async (e) => {
      e.preventDefault();
      const url = discord.webhook.value.trim();
      const urlAnn = discord.webhookAnn.value.trim();
      if ((url && !HOOK_RE.test(url)) || (urlAnn && !HOOK_RE.test(urlAnn))) {
        return toast("Une des adresses n'est pas un webhook Discord valide.", 'error');
      }
      const rows = TOGGLES.map(([k]) => ({ key: k, value: discord[k].checked, updated_by: me }));
      await busy(discord.querySelector('button[type=submit]'), async () => {
        const now = new Date().toISOString();
        const a = await sb.from('private_settings').upsert([
          { key: 'discord_webhook', value: url, updated_at: now },
          { key: 'discord_webhook_announcements', value: urlAnn, updated_at: now },
        ], { onConflict: 'key' });
        if (a.error) return toast(errMsg(a.error), 'error');
        const b = await sb.from('settings').upsert(rows, { onConflict: 'key' });
        if (b.error) return toast(errMsg(b.error), 'error');
        await loadSettings();
        toast('Configuration Discord enregistrée.', 'ok');
      });
    };

    const testHook = (id, target, label) => {
      view.querySelector(id).onclick = (e) => busy(e.currentTarget, async () => {
        const { error } = await sb.rpc('admin_test_discord', { p_target: target });
        if (error) return toast(errMsg(error), 'error');
        toast(`Message de test envoyé (${label}). Enregistrez d'abord le webhook, puis vérifiez votre salon Discord.`, 'ok');
      });
    };
    testHook('#testDiscord', 'notifications', 'notifications');
    testHook('#testDiscordAnn', 'announcements', 'annonces');

    view.querySelectorAll('[data-img]').forEach((input) => {
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        if (!IMG_TYPES.includes(file.type)) { input.value = ''; return toast('Format non accepté (PNG, JPG ou WEBP).', 'error'); }
        if (file.size > 2 * 1024 * 1024) { input.value = ''; return toast('Image trop lourde (2 Mo maximum).', 'error'); }
        const kind = input.dataset.img;
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
        const path = `${kind}-${Date.now()}.${ext}`;
        const old = state.settings[`${kind}_path`];
        try {
          const up = await sb.storage.from('branding').upload(path, file, { contentType: file.type, cacheControl: '3600' });
          if (up.error) throw up.error;
          const { error } = await sb.from('settings').upsert({ key: `${kind}_path`, value: path, updated_by: me }, { onConflict: 'key' });
          if (error) throw error;
          if (old) await sb.storage.from('branding').remove([old]);
          await loadSettings();
          applyBrand();
          draw();
          toast('Image mise à jour.', 'ok');
        } catch (err) { toast(errMsg(err), 'error'); }
      };
    });

    view.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = async () => {
        const kind = b.dataset.reset;
        if (!(await confirmBox("Revenir à l'image par défaut ?"))) return;
        const old = state.settings[`${kind}_path`];
        const { error } = await sb.from('settings').upsert({ key: `${kind}_path`, value: null, updated_by: me }, { onConflict: 'key' });
        if (error) return toast(errMsg(error), 'error');
        if (old) await sb.storage.from('branding').remove([old]);
        await loadSettings();
        applyBrand();
        draw();
        toast('Image par défaut rétablie.', 'ok');
      };
    });
  };

  function applyBrand() {
    const b = document.querySelector('.brand b');
    const i = document.querySelector('.brand img');
    if (b) b.textContent = state.settings.mairie_name;
    if (i) i.src = brandURL('logo');
  }

  draw();
}
