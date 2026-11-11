import { sb, state, can, signedUrls } from './state.js';
import { brandURL, toPng } from './branding.js';
import { fmtDate, fmtDT } from './lib.js';

const C = {
  navy: [15, 34, 80],
  navy2: [8, 21, 51],
  gold: [201, 162, 39],
  text: [28, 36, 56],
  muted: [104, 116, 143],
  line: [224, 229, 241],
  soft: [246, 248, 253],
  blue: [29, 63, 154],
  red: [211, 58, 58],
};

const SERVICE = { police: 'Police', gendarmerie: 'Gendarmerie' };
const W = 210;
const H = 297;
const MX = 16;
const CW = W - MX * 2;
const TOP = 22;
const BOTTOM = H - 20;

const t = (s) => String(s ?? '')
  .normalize('NFC')
  .replace(/[\u00a0\u202f\u2007\u2009\u200a]/g, ' ')
  .replace(/[–—−]/g, '-')
  .replace(/[‘’‚]/g, "'")
  .replace(/[“”„]/g, '"')
  .replace(/…/g, '...')
  .replace(/[•·]/g, '-')
  .replace(/€/g, 'EUR')
  .replace(/œ/g, 'oe')
  .replace(/Œ/g, 'OE')
  .replace(/[^\n\x20-\x7e¡-ÿ]/g, '')
  .trim();

async function loadJsPdf() {
  const mod = await import('https://esm.sh/jspdf@2.5.1');
  return mod.jsPDF || mod.default?.jsPDF || mod.default;
}

async function brandImages() {
  const get = async (kind, w, h) => { try { return await toPng(brandURL(kind), w, h); } catch (e) { console.error(e); return null; } };
  const [logo, stamp, signature] = await Promise.all([get('logo', 500, 500), get('stamp', 600, 600), get('signature', 800, 300)]);
  return { logo, stamp, signature };
}

async function loadPhoto(url, max = 1100) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('image');
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = obj;
    await img.decode();
    const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { data: canvas.toDataURL('image/jpeg', 0.8), w, h };
  } finally {
    URL.revokeObjectURL(obj);
  }
}

class Report {
  constructor(jsPDF, { title, subtitle, brand, footerRef }) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    this.s = state.settings;
    this.brand = brand;
    this.title = title;
    this.footerRef = footerRef;
    this.y = 0;
    this.firstPage(subtitle);
  }

  tricolor(x, y, w, h) {
    const d = this.doc;
    const bw = w / 3;
    d.setFillColor(...C.blue); d.rect(x, y, bw, h, 'F');
    d.setFillColor(255, 255, 255); d.rect(x + bw, y, bw, h, 'F');
    d.setFillColor(...C.red); d.rect(x + bw * 2, y, bw, h, 'F');
  }

  firstPage(subtitle) {
    const d = this.doc;
    d.setFillColor(...C.navy2); d.rect(0, 0, W, 46, 'F');
    d.setFillColor(...C.navy); d.rect(0, 0, W, 34, 'F');
    this.tricolor(0, 46, W, 2.2);
    d.setFillColor(255, 255, 255); d.circle(MX + 13, 23, 14, 'F');
    d.setDrawColor(...C.gold); d.setLineWidth(0.6); d.circle(MX + 13, 23, 14, 'S');
    if (this.brand.logo) d.addImage(this.brand.logo.data, 'PNG', MX + 2.5, 12.5, 21, 21);
    d.setTextColor(255, 255, 255);
    d.setFont('times', 'bold'); d.setFontSize(21);
    d.text(t(String(this.s.mairie_name || "MAIRIE D'AMBOISE").toUpperCase()), MX + 34, 20);
    d.setFont('helvetica', 'normal'); d.setFontSize(8.5); d.setTextColor(...C.gold);
    d.text(t(this.s.pdf_extra || 'Nova Life RP').toUpperCase(), MX + 34, 27.5, { charSpace: 0.6 });
    d.setTextColor(206, 216, 240); d.setFontSize(9);
    d.text(t(subtitle), MX + 34, 40);

    d.setTextColor(...C.navy);
    d.setFont('times', 'bold'); d.setFontSize(22);
    d.text(t(this.title), MX, 64);
    d.setDrawColor(...C.gold); d.setLineWidth(1); d.line(MX, 68, MX + 30, 68);
    this.y = 78;
  }

  nextPage() {
    const d = this.doc;
    d.addPage();
    d.setFillColor(...C.navy); d.rect(0, 0, W, 12, 'F');
    this.tricolor(0, 12, W, 1);
    d.setFont('times', 'bold'); d.setFontSize(10); d.setTextColor(255, 255, 255);
    d.text(t(String(this.s.mairie_name || '').toUpperCase()), MX, 8);
    d.setFont('helvetica', 'normal'); d.setFontSize(8.5); d.setTextColor(...C.gold);
    d.text(t(this.footerRef), W - MX, 8, { align: 'right' });
    this.y = TOP;
  }

  ensure(h) {
    if (this.y + h > BOTTOM) this.nextPage();
  }

  refBox(items) {
    const d = this.doc;
    const cols = Math.min(items.length, 3);
    const rows = Math.ceil(items.length / cols);
    const cw = CW / cols;
    const rh = 15;
    this.ensure(rows * rh + 6);
    d.setFillColor(...C.soft); d.setDrawColor(...C.line); d.setLineWidth(0.3);
    d.roundedRect(MX, this.y, CW, rows * rh, 2.5, 2.5, 'FD');
    d.setFillColor(...C.gold); d.rect(MX, this.y + 1.5, 1.2, rows * rh - 3, 'F');
    items.forEach(([label, value], i) => {
      const cx = MX + (i % cols) * cw + 6;
      const cy = this.y + Math.floor(i / cols) * rh + 6;
      d.setFont('helvetica', 'bold'); d.setFontSize(7); d.setTextColor(...C.muted);
      d.text(t(label).toUpperCase(), cx, cy, { charSpace: 0.4 });
      d.setFont('helvetica', 'bold'); d.setFontSize(10.5); d.setTextColor(...C.navy);
      const line = d.splitTextToSize(t(value) || '-', cw - 8)[0];
      d.text(line, cx, cy + 5.5);
    });
    this.y += rows * rh + 8;
  }

  section(title) {
    const d = this.doc;
    this.ensure(24);
    this.y += 2;
    d.setFillColor(...C.gold); d.rect(MX, this.y - 3.6, 2.4, 4.8, 'F');
    d.setFont('helvetica', 'bold'); d.setFontSize(9.5); d.setTextColor(...C.navy);
    d.text(t(title).toUpperCase(), MX + 5, this.y, { charSpace: 0.5 });
    d.setDrawColor(...C.line); d.setLineWidth(0.3);
    d.line(MX, this.y + 2.6, W - MX, this.y + 2.6);
    this.y += 9;
  }

  para(text, { muted = false, size = 10.5 } = {}) {
    const d = this.doc;
    d.setFont('helvetica', muted ? 'italic' : 'normal'); d.setFontSize(size);
    d.setTextColor(...(muted ? C.muted : C.text));
    const lines = d.splitTextToSize(t(text), CW);
    lines.forEach((ln) => { this.ensure(6); d.text(ln, MX, this.y); this.y += 5.2; });
    this.y += 2.5;
  }

  kv(rows) {
    const d = this.doc;
    rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').forEach(([label, value]) => {
      d.setFontSize(10.5);
      const lines = d.splitTextToSize(t(value), CW - 48);
      this.ensure(lines.length * 5.2 + 2);
      d.setFont('helvetica', 'bold'); d.setTextColor(...C.muted);
      d.text(t(label), MX, this.y);
      d.setFont('helvetica', 'normal'); d.setTextColor(...C.text);
      lines.forEach((ln, i) => d.text(ln, MX + 46, this.y + i * 5.2));
      this.y += lines.length * 5.2 + 1.6;
    });
    this.y += 2;
  }

  table(cols, rows) {
    const d = this.doc;
    const total = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * CW);
    const head = () => {
      this.ensure(14);
      d.setFillColor(...C.navy); d.rect(MX, this.y - 4.6, CW, 7.4, 'F');
      d.setFont('helvetica', 'bold'); d.setFontSize(8); d.setTextColor(255, 255, 255);
      let x = MX + 3;
      cols.forEach((c, i) => { d.text(t(c.label).toUpperCase(), x, this.y, { charSpace: 0.3 }); x += widths[i]; });
      this.y += 7;
    };
    head();
    rows.forEach((row, ri) => {
      d.setFont('helvetica', 'normal'); d.setFontSize(9.5);
      const cells = row.map((cell, i) => d.splitTextToSize(t(cell) || '-', widths[i] - 5));
      const lines = Math.max(...cells.map((c) => c.length));
      const rh = lines * 4.6 + 3.4;
      if (this.y + rh > BOTTOM) { this.nextPage(); head(); }
      if (ri % 2 === 0) { d.setFillColor(...C.soft); d.rect(MX, this.y - 3.8, CW, rh, 'F'); }
      d.setTextColor(...C.text);
      let x = MX + 3;
      cells.forEach((c, i) => {
        c.forEach((ln, li) => d.text(ln, x, this.y + li * 4.6));
        x += widths[i];
      });
      this.y += rh;
    });
    d.setDrawColor(...C.line); d.setLineWidth(0.3); d.line(MX, this.y - 3.4, W - MX, this.y - 3.4);
    this.y += 5;
  }

  empty(text) {
    this.para(text, { muted: true });
  }

  photos(items) {
    const d = this.doc;
    const gap = 6;
    const bw = (CW - gap) / 2;
    const bh = 62;
    for (let i = 0; i < items.length; i += 2) {
      this.ensure(bh + 18);
      const pair = items.slice(i, i + 2);
      let tallest = 0;
      pair.forEach((it, k) => {
        const x = MX + k * (bw + gap);
        d.setFillColor(...C.soft); d.setDrawColor(...C.line); d.setLineWidth(0.3);
        d.roundedRect(x, this.y, bw, bh, 2, 2, 'FD');
        if (it.img) {
          const r = Math.min((bw - 4) / it.img.w, (bh - 4) / it.img.h);
          const iw = it.img.w * r; const ih = it.img.h * r;
          d.addImage(it.img.data, 'JPEG', x + (bw - iw) / 2, this.y + (bh - ih) / 2, iw, ih);
        } else {
          d.setFont('helvetica', 'italic'); d.setFontSize(9); d.setTextColor(...C.muted);
          d.text('Image indisponible', x + bw / 2, this.y + bh / 2, { align: 'center' });
        }
        d.setFont('helvetica', 'bold'); d.setFontSize(9); d.setTextColor(...C.navy);
        const cap = d.splitTextToSize(t(it.caption), bw).slice(0, 2);
        cap.forEach((ln, li) => d.text(ln, x, this.y + bh + 5 + li * 4));
        d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.setTextColor(...C.muted);
        d.text(t(it.meta), x, this.y + bh + 5 + cap.length * 4 + 0.5);
        tallest = Math.max(tallest, cap.length * 4 + 6);
      });
      this.y += bh + tallest + 8;
    }
  }

  signature({ left, role, name, title, withSeal }) {
    const d = this.doc;
    this.ensure(64);
    this.y += 4;
    const top = this.y;
    d.setFont('helvetica', 'normal'); d.setFontSize(10.5); d.setTextColor(...C.text);
    d.text(t(left), MX, top + 4);
    const sx = 120;
    d.setFont('helvetica', 'bold'); d.setFontSize(10.5);
    d.text(t(role), sx, top + 4);
    if (withSeal) {
      const { signature, stamp } = this.brand;
      if (signature) {
        const sw = 54; const sh = Math.min(22, sw * (signature.h / signature.w));
        d.addImage(signature.data, 'PNG', sx, top + 8, sw, sh);
      }
      if (stamp) d.addImage(stamp.data, 'PNG', sx - 34, top + 2, 36, 36);
    } else {
      d.setDrawColor(...C.line); d.setLineWidth(0.3);
      d.roundedRect(sx, top + 8, 62, 26, 2, 2, 'S');
    }
    d.setFont('times', 'bold'); d.setFontSize(13); d.setTextColor(...C.navy);
    d.text(t(name), sx, top + 42);
    d.setFont('times', 'normal'); d.setFontSize(10.5); d.setTextColor(...C.text);
    d.text(t(title), sx, top + 47.5);
    this.y = top + 54;
  }

  finish(filename) {
    const d = this.doc;
    const pages = d.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      d.setPage(i);
      d.setDrawColor(...C.gold); d.setLineWidth(0.4); d.line(MX, H - 15, W - MX, H - 15);
      d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.setTextColor(...C.muted);
      d.text(t(this.s.pdf_footer || ''), W / 2, H - 10.5, { align: 'center' });
      d.text(t(this.footerRef), MX, H - 6);
      d.text(`Page ${i} / ${pages}`, W - MX, H - 6, { align: 'right' });
    }
    d.save(filename);
  }
}

const personRows = (m) => [['Prénom', m.person_first], ['Nom', m.person_last], ['Informations', m.person_info]];

function listSections(r, { complices, terrains, vehicles }) {
  r.section('Complices');
  if (complices.length) {
    r.table([{ label: 'Prénom', w: 3 }, { label: 'Nom', w: 3 }, { label: 'Informations', w: 5 }],
      complices.map((c) => [c.prenom, c.nom, c.infos]));
  } else r.empty('Aucun complice déclaré.');

  r.section('Terrains concernés');
  if (terrains.length) {
    r.table([{ label: 'N°', w: 2 }, { label: 'Adresse / localisation', w: 5 }, { label: 'Informations', w: 5 }],
      terrains.map((x) => [`#${x.numero}`, x.adresse, x.infos]));
  } else r.empty('Aucun terrain concerné.');

  r.section('Véhicules concernés');
  if (vehicles.length) {
    r.table([{ label: 'Véhicule', w: 5 }, { label: 'Couleur', w: 2.5 }, { label: 'Plaque', w: 3 }, { label: 'Informations', w: 4 }],
      vehicles.map((v) => [`${v.marque} ${v.modele}`.trim(), v.couleur, v.plaque, v.infos]));
  } else r.empty('Aucun véhicule concerné.');
}

export async function downloadMandatePdf(full) {
  const jsPDF = await loadJsPdf();
  const { mandate: m, complices, terrains, vehicles } = full;
  const s = state.settings;
  const brand = await brandImages();
  const issued = m.decided_at || new Date();

  const r = new Report(jsPDF, {
    title: 'Autorisation de perquisition',
    subtitle: 'Document officiel - Mairie',
    brand,
    footerRef: `Mandat #${m.number}`,
  });

  r.refBox([
    ['Numéro du mandat', `#${m.number}`],
    ['Date de délivrance', fmtDate(issued)],
    ['Service demandeur', SERVICE[m.service] || m.service],
  ]);

  r.para(`Nous, ${s.maire_name || 'Gabin Muller'}, ${s.maire_title || "Maire d'Amboise"}, autorisons le service ${SERVICE[m.service] || ''}, représenté par ${m.requester_name || 'son responsable'}, à procéder à la perquisition visant la personne et les lieux désignés ci-dessous, dans le cadre du motif exposé dans le présent mandat.`);

  r.section('Personne concernée');
  r.kv(personRows(m));
  listSections(r, { complices, terrains, vehicles });

  r.section('Motif de la perquisition');
  r.para(m.motif || '-');

  r.section('Objets recherchés');
  if (m.objets_recherches) r.para(m.objets_recherches); else r.empty('Non précisé.');

  if (m.agents_concernes || m.date_souhaitee) {
    r.section('Modalités');
    r.kv([
      ['Agents concernés', m.agents_concernes],
      ['Date prévue', m.date_souhaitee ? fmtDate(m.date_souhaitee) : ''],
      ['Heure prévue', m.heure_souhaitee ? String(m.heure_souhaitee).slice(0, 5) : ''],
    ]);
  }

  r.signature({
    left: `Fait à ${s.pdf_city || 'Amboise'}, le ${fmtDate(issued)}`,
    role: 'Le Maire,',
    name: s.maire_name || 'Gabin Muller',
    title: s.maire_title || "Maire d'Amboise",
    withSeal: true,
  });

  r.finish(`Autorisation-perquisition-${m.number}.pdf`);
}

const MAX_PHOTOS = 40;

export async function downloadClosurePdf(full) {
  const jsPDF = await loadJsPdf();
  const { mandate: m, complices, terrains, vehicles, files } = full;
  const s = state.settings;
  const brand = await brandImages();

  let history = [];
  try {
    const { data } = await sb.from('mandate_history').select('*').eq('mandate_id', m.id).order('created_at', { ascending: true });
    history = data || [];
  } catch (e) { console.error(e); }

  const images = (files || []).filter((f) => (f.mime_type || '').startsWith('image/'));
  const docsOnly = (files || []).filter((f) => !(f.mime_type || '').startsWith('image/'));
  const seizedImgs = images.filter((f) => f.is_seizure);
  const otherImgs = images.filter((f) => !f.is_seizure);
  const seizedDocs = docsOnly.filter((f) => f.is_seizure);
  const otherDocs = docsOnly.filter((f) => !f.is_seizure);
  const wanted = [...seizedImgs, ...otherImgs].slice(0, MAX_PHOTOS);
  const skipped = images.length - wanted.length;

  let urls = new Map();
  try { urls = await signedUrls(wanted.map((f) => f.path)); } catch (e) { console.error(e); }
  const loaded = new Map();
  const queue = [...wanted];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      try {
        const url = urls.get(f.path);
        if (url) loaded.set(f.id, await loadPhoto(url));
      } catch (e) { console.error(e); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const card = (f) => ({
    img: loaded.get(f.id) || null,
    caption: f.caption || f.file_name,
    meta: `${f.uploaded_by_name || ''} - ${fmtDT(f.created_at)}`,
  });

  const r = new Report(jsPDF, {
    title: 'Rapport de clôture de mandat',
    subtitle: "Document officiel - Compte rendu d'intervention",
    brand,
    footerRef: `Mandat #${m.number} - Rapport de clôture`,
  });

  r.refBox([
    ['Numéro du mandat', `#${m.number}`],
    ['Service', SERVICE[m.service] || m.service],
    ['Statut', 'Clôturé'],
    ['Validé par', m.decided_by_name],
    ['Clôturé par', m.closed_by_name],
    ['Clôturé le', fmtDate(m.closed_at)],
  ]);

  r.section("Bilan de l'intervention");
  if (m.closure_summary) r.para(m.closure_summary); else r.empty('Aucun bilan renseigné.');

  r.section('Personne concernée');
  r.kv(personRows(m));
  listSections(r, { complices, terrains, vehicles });

  r.section('Motif et objets recherchés');
  r.kv([
    ['Motif', m.motif],
    ['Objets recherchés', m.objets_recherches],
    ['Agents concernés', m.agents_concernes],
  ]);

  r.section(`Pièces saisies (${seizedImgs.length + seizedDocs.length})`);
  if (seizedImgs.length) r.photos(seizedImgs.filter((f) => wanted.includes(f)).map(card));
  if (seizedDocs.length) {
    r.table([{ label: 'Document', w: 6 }, { label: 'Ajouté par', w: 3 }, { label: 'Date', w: 3 }],
      seizedDocs.map((f) => [f.caption || f.file_name, f.uploaded_by_name, fmtDT(f.created_at)]));
  }
  if (!seizedImgs.length && !seizedDocs.length) r.empty('Aucune pièce saisie enregistrée.');

  const others = otherImgs.filter((f) => wanted.includes(f));
  if (others.length) {
    r.section(`Autres photos du dossier (${otherImgs.length})`);
    r.photos(others.map(card));
  }
  if (skipped > 0) r.para(`${skipped} photo(s) supplémentaire(s) non incluses dans ce rapport.`, { muted: true, size: 9 });

  if (otherDocs.length) {
    r.section('Documents joints au dossier');
    r.table([{ label: 'Document', w: 6 }, { label: 'Ajouté par', w: 3 }, { label: 'Date', w: 3 }],
      otherDocs.map((f) => [f.file_name, f.uploaded_by_name, fmtDT(f.created_at)]));
  }

  if (history.length) {
    r.section('Chronologie du dossier');
    r.table([{ label: 'Date', w: 3 }, { label: 'Auteur', w: 3 }, { label: 'Événement', w: 7 }],
      history.map((h) => [fmtDT(h.created_at), h.actor_name || 'Système', h.message]));
  }

  const mayor = can.mayor();
  r.signature({
    left: `Fait à ${s.pdf_city || 'Amboise'}, le ${fmtDate(new Date())}`,
    role: mayor ? 'Le Maire,' : 'Clôturé par',
    name: mayor ? (s.maire_name || 'Gabin Muller') : (m.closed_by_name || ''),
    title: mayor ? (s.maire_title || "Maire d'Amboise") : 'Visa du Maire : ______________',
    withSeal: mayor,
  });

  r.finish(`Rapport-cloture-${m.number}.pdf`);
}
