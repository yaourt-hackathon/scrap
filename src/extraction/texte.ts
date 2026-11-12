import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

const BLOCS =
  'p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, tr, table, section, article, blockquote, dd, dt';
const INVISIBLE = 'script, style, noscript, template, svg';
const BRUIT = `${INVISIBLE}, iframe, form, nav, header, footer, aside, [role="navigation"], [aria-hidden="true"], [class*="cookie"], [id*="cookie"]`;

/** HTML → texte lisible : un paragraphe par ligne, sans menus ni scripts. */
export function texteDepuisHtml(html: string, retirerBruit = true): string {
  const $ = cheerio.load(`<div id="__racine">${html}</div>`);
  return texteDe($, $('#__racine'), retirerBruit);
}

/**
 * Texte d'un élément d'une page déjà chargée. Scripts et styles sont toujours retirés ;
 * `retirerBruit` retire aussi menus, en-têtes, pieds de page et blocs cachés.
 */
export function texteDe(
  $: CheerioAPI,
  element: Cheerio<AnyNode>,
  retirerBruit = true,
): string {
  const copie = element.clone();
  copie.find(retirerBruit ? BRUIT : INVISIBLE).remove();
  copie.find('br').replaceWith('\n');
  copie.find(BLOCS).each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  return copie
    .text()
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Le texte principal d'une page : sélecteur donné, sinon <main>/<article>, sinon <body>. */
export function textePrincipal($: CheerioAPI, selecteur?: string): string {
  const candidats = selecteur
    ? [selecteur]
    : ['article', 'main', '[role="main"]', '#content', '.content', 'body'];
  for (const sel of candidats) {
    const el = $(sel).first();
    if (!el.length) continue;
    const texte = texteDe($, el);
    if (texte.length > 200 || sel === candidats.at(-1)) return texte;
  }
  return '';
}

/** « fleur d&#039;oranger » → « fleur d'oranger » (certains sites encodent deux fois leur JSON-LD). */
export function decoderEntites(texte: string): string {
  if (!/&(#\d+|#x[\da-f]+|\w+);/i.test(texte)) return texte;
  return cheerio
    .load(`<i>${texte.replaceAll('<', '&lt;')}</i>`)('i')
    .text();
}

/** « Ladrôme » → « Ladrome ». */
export function sansAccent(texte: string): string {
  return texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** « So'Bio étic » → « so-bio-etic » : l'identifiant d'une marque, comme `slug()` du dépôt data. */
export function slug(texte: string): string {
  return sansAccent(texte)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Tronque un texte sur une fin de mot, avec « … ». */
export function tronquer(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  const coupe = texte.slice(0, max);
  const espace = coupe.lastIndexOf(' ');
  // Sans espace dans la seconde moitié (un très long mot), on coupe net.
  return coupe.slice(0, espace > max / 2 ? espace : max).trimEnd() + ' …';
}

const MOIS: Record<string, number> = {
  janvier: 1,
  janv: 1,
  fevrier: 2,
  fevr: 2,
  fev: 2,
  mars: 3,
  avril: 4,
  avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  juil: 7,
  aout: 8,
  septembre: 9,
  sept: 9,
  octobre: 10,
  oct: 10,
  novembre: 11,
  nov: 11,
  decembre: 12,
  dec: 12,
};

/**
 * Une date lue n'importe où → `AAAA-MM-JJ`, ou '' si on ne sait pas la lire.
 * Accepte ISO 8601, RFC 822 (flux RSS), `20261110T123000Z` et `20261110123000` (GDELT), `12/11/2026`, `12 novembre 2026`.
 */
export function dateIso(brute: string | undefined | null): string {
  const s = (brute ?? '').trim();
  if (!s) return '';

  // 20261110T123000Z (API GDELT), 20261110123000 (fichiers et BigQuery GDELT), 20261110.
  let m = /^(\d{4})(\d{2})(\d{2})(?:T?\d{6}Z?)?$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return format(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /(\d{1,2})(?:er)?\s+([a-z]+)\.?\s+(\d{4})/.exec(
    sansAccent(s).toLowerCase(),
  );
  if (m && MOIS[m[2] ?? ''])
    return format(Number(m[3]), MOIS[m[2] ?? ''] ?? 0, Number(m[1]));

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

function format(annee: number, mois: number, jour: number): string {
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return '';
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/** URL absolue, sans le fragment (#…). '' si l'adresse est inutilisable. */
export function urlAbsolue(href: string | undefined, base: string): string {
  if (!href) return '';
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}
