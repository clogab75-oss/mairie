import { state } from './state.js';
import { brandURL, toPng } from './branding.js';
import { fmtDate } from './lib.js';

const NAVY = [20, 40, 79];
const GOLD = [201, 162, 39];
const TEXT = [28, 36, 56];
const MUTED = [107, 117, 144];

const SERVICE = { police: 'Police', gendarmerie: 'Gendarmerie' };

const clean = (s) => String(s ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

async function loadJsPdf() {
  const mod = await import('https://esm.sh/jspdf@2.5.1');
  return mod.jsPDF || mod.default?.jsPDF || mod.default;
}

export async function downloadMandatePdf(full) {
  const jsPDF = await loadJsPdf();
  const { mandate: m, complices, terrains, vehicles } = full;
  const s = state.settings;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210; const H = 297; const MX = 18; const CW = W - MX * 2;
  let y = 0;

  const img = async (kind, w, h) => { try { return await toPng(brandURL(kind), w, h); } catch { return null; } };
  const [logo, stamp, signature] = await Promise.all([img('logo', 500, 500), img('stamp', 600, 600), img('signature', 800, 300)]);

  if (logo) doc.addImage(logo.data, 'PNG', MX, 12, 26, 26);
  doc.setTextColor(...NAVY);
  doc.setFont('times', 'bold'); doc.setFontSize(21);
  doc.text(clean(String(s.mairie_name || "MAIRIE D'AMBOISE").toUpperCase()), W / 2 + 8, 22, { align: 'center' });
  doc.setFont('times', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED);
  doc.text(clean(s.pdf_extra || ''), W / 2 + 8, 29, { align: 'center' });

  const bw = CW / 3;
  doc.setDrawColor(215, 219, 230); doc.setLineWidth(0.2);
  doc.setFillColor(29, 63, 154); doc.rect(MX, 43, bw, 2, 'F');
  doc.setFillColor(255, 255, 255); doc.rect(MX + bw, 43, bw, 2, 'FD');
  doc.setFillColor(211, 58, 58); doc.rect(MX + bw * 2, 43, bw, 2, 'F');

  doc.setTextColor(...NAVY);
  doc.setFont('times', 'bold'); doc.setFontSize(19);
  doc.text('AUTORISATION DE PERQUISITION', W / 2, 59, { align: 'center' });
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.8); doc.line(W / 2 - 34, 62.5, W / 2 + 34, 62.5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...TEXT);
  doc.text(clean(`Numéro du mandat : #${m.number}`), W / 2, 71, { align: 'center' });
  y = 82;

  const ensure = (h) => { if (y + h > H - 22) { doc.addPage(); y = 20; } };
  const section = (title) => {
    ensure(22); y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY);
    doc.text(clean(title.toUpperCase()), MX, y, { charSpace: 0.4 });
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.5); doc.line(MX, y + 1.8, W - MX, y + 1.8);
    y += 8;
  };
  const para = (text, { italic = false } = {}) => {
    doc.setFont('helvetica', italic ? 'italic' : 'normal'); doc.setFontSize(11);
    doc.setTextColor(...(italic ? MUTED : TEXT));
    const lines = doc.splitTextToSize(clean(text), CW);
    lines.forEach((ln) => { ensure(6); doc.text(ln, MX, y); y += 5.4; });
    y += 1.5;
  };
  const kv = (label, value) => {
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(clean(value || '-'), CW - 40);
    ensure(lines.length * 5.4 + 1);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...MUTED); doc.text(clean(label), MX, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...TEXT);
    lines.forEach((ln, i) => doc.text(ln, MX + 40, y + i * 5.4));
    y += lines.length * 5.4 + 0.8;
  };
  const bullets = (items) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...TEXT);
    items.forEach((t) => {
      const lines = doc.splitTextToSize(clean(t), CW - 8);
      ensure(lines.length * 5.4 + 1);
      doc.text('•', MX + 2, y);
      lines.forEach((ln, i) => doc.text(ln, MX + 8, y + i * 5.4));
      y += lines.length * 5.4 + 0.8;
    });
    y += 1;
  };

  section('Personne concernée');
  kv('Prénom :', m.person_first);
  kv('Nom :', m.person_last);
  if (m.person_info) kv('Informations :', m.person_info);

  section('Complices');
  if (complices.length) bullets(complices.map((c) => `${c.prenom} ${c.nom}`.trim() + (c.infos ? ` (${c.infos})` : '')));
  else para('Aucun complice déclaré.', { italic: true });

  section('Terrains concernés');
  if (terrains.length) bullets(terrains.map((t) => `Terrain #${t.numero}` + (t.adresse ? ` - ${t.adresse}` : '') + (t.infos ? ` (${t.infos})` : '')));
  else para('Aucun terrain concerné.', { italic: true });

  section('Véhicules concernés');
  if (vehicles.length) {
    bullets(vehicles.map((v) => [`${v.marque} ${v.modele}`.trim(), v.couleur, v.plaque].filter(Boolean).join(' - ')
      + (v.infos ? ` (${v.infos})` : '')));
  } else para('Aucun véhicule concerné.', { italic: true });

  section('Service demandeur');
  para(SERVICE[m.service] || m.service);

  section('Responsable');
  para(m.requester_name || '-');

  section('Motif');
  para(m.motif || '-');

  section('Objets recherchés');
  para(m.objets_recherches || 'Non précisé.', { italic: !m.objets_recherches });

  section('Date de délivrance');
  para(fmtDate(m.decided_at || new Date()));

  ensure(66); y += 6;
  const top = y;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...TEXT);
  doc.text(clean(`Fait à ${s.pdf_city || 'Amboise'}, le ${fmtDate(m.decided_at || new Date())}`), MX, top);

  const sx = 118;
  doc.setFont('helvetica', 'bold'); doc.text('Le Maire,', sx, top);
  if (signature) {
    const sw = 56; const sh = Math.min(24, sw * (signature.h / signature.w));
    doc.addImage(signature.data, 'PNG', sx, top + 3, sw, sh);
  }
  if (stamp) doc.addImage(stamp.data, 'PNG', sx - 36, top - 2, 38, 38);
  doc.setFont('times', 'bold'); doc.setFontSize(13); doc.setTextColor(...NAVY);
  doc.text(clean(s.maire_name || 'Gabin Muller'), sx, top + 34);
  doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(...TEXT);
  doc.text(clean(s.maire_title || "Maire d'Amboise"), sx, top + 40);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.3); doc.line(MX, H - 16, W - MX, H - 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(clean(s.pdf_footer || ''), W / 2, H - 11.5, { align: 'center' });
    doc.text(clean(`Mandat #${m.number}`), MX, H - 7);
    doc.text(`Page ${i}/${pages}`, W - MX, H - 7, { align: 'right' });
  }

  doc.save(`Autorisation-perquisition-${m.number}.pdf`);
}
