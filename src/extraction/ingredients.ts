import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { texteDe } from './texte.ts';

/**
 * Trouver la liste d'ingrédients (INCI) d'une fiche produit sans connaître le site.
 *
 * 1. On cherche les libellés (« Ingrédients », « Composition », « Liste INCI »…) et ce qui les suit :
 *    frère suivant, panneau d'onglet (`aria-controls`, `href="#…"`), `<dd>` d'un `<dt>`, reste du paragraphe.
 * 2. À défaut, on note chaque bloc de texte de la page sur sa ressemblance à une liste INCI.
 * Dans chaque candidat on garde la meilleure ligne, plus les notes qui la suivent (« *issus de l'agriculture biologique »).
 *
 * C'est une heuristique : si un site la met en échec, passez un sélecteur CSS (`selecteurs.ingredients`).
 */
export function trouverIngredients($: CheerioAPI, selecteur?: string): string {
  if (selecteur) {
    // Le sélecteur désigne le bloc ingrédients : on accepte une liste courte, et à défaut tout le bloc.
    const el = $(selecteur).first();
    if (!el.length) return '';
    const texte = texteDe($, el, false);
    return (
      meilleurExtrait(texte, true)?.texte ??
      texte.replace(RE_PREFIXE, '').replace(/\n/g, ' ')
    );
  }

  let meilleur: { texte: string; score: number } | undefined;
  const proposer = (texte: string, bonus: number) => {
    // Près d'un libellé, une liste courte est plausible (« Butyrospermum Parkii Butter* »).
    const extrait = meilleurExtrait(texte, bonus > 0);
    if (!extrait) return;
    const score = extrait.score + bonus;
    if (!meilleur || score > meilleur.score)
      meilleur = { texte: extrait.texte, score };
  };

  // 1. Autour des libellés.
  $(LIBELLES).each((_, el) => {
    const libelle = $(el);
    const propre = libelle
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const complet = libelle.text().replace(/\s+/g, ' ').trim();
    if (!RE_LIBELLE.test(propre) && !RE_LIBELLE.test(complet.slice(0, 60)))
      return;

    for (const cible of ciblesDuLibelle($, libelle)) {
      proposer(texteDe($, cible, false), 10);
    }
  });

  // 2. Partout : chaque bloc sans sous-bloc.
  $('p, li, td, dd, div, span').each((_, el) => {
    const bloc = $(el);
    if (bloc.children('p, div, ul, ol, li, table, section').length) return;
    const texte = bloc.text();
    if (texte.length < 30 || texte.length > 6000) return;
    proposer(texteDe($, bloc, false), 0);
  });

  return meilleur && meilleur.score >= SEUIL ? meilleur.texte : '';
}

/** Même chose depuis un fragment HTML (description Shopify, WooCommerce…). */
export function ingredientsDepuisHtml(html: string): string {
  if (!html) return '';
  return trouverIngredients(cheerio.load(`<div>${html}</div>`));
}

const LIBELLES =
  'h1, h2, h3, h4, h5, h6, strong, b, dt, th, button, summary, label, a, span, p, li, div';
const RE_LIBELLE =
  /^(?:liste\s+(?:des\s+)?|la\s+|notre\s+|les\s+)?(?:ingr[ée]dients?|composition|inci|formule|formulation)\b/i;
const RE_PREFIXE =
  /^(?:liste\s+(?:des\s+|d['’]\s*)?)?(?:ingr[ée]dients?|composition|inci|formule)(?:\s*\(?inci\)?|\s+compl[eè]te?s?)?\s*[:-]\s*/i;
const SEUIL = 12;

function* ciblesDuLibelle(
  $: CheerioAPI,
  libelle: Cheerio<AnyNode>,
): Generator<Cheerio<AnyNode>> {
  const controle = libelle.attr('aria-controls');
  if (controle) yield parId($, controle);
  const href = libelle.attr('href');
  if (href?.startsWith('#') && href.length > 1) yield parId($, href.slice(1));
  if (libelle.is('dt')) yield libelle.nextAll('dd').first();
  // Le libellé et la liste dans le même bloc : « <p><strong>Ingrédients :</strong> Aqua, … </p> ».
  yield libelle.parent();
  yield libelle;
  // La liste juste après le libellé, ou après son conteneur.
  yield libelle.nextAll().slice(0, 3);
  yield libelle.parent().nextAll().slice(0, 2);
}

function parId($: CheerioAPI, id: string): Cheerio<AnyNode> {
  return $(`[id="${id.replace(/["\\]/g, '\\$&')}"]`);
}

/** La ligne la plus « INCI » d'un texte, avec les notes qui la suivent. */
function meilleurExtrait(
  texte: string,
  souple = false,
): { texte: string; score: number } | undefined {
  const lignes = texte
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let meilleur: { index: number; score: number; ligne: string } | undefined;
  lignes.forEach((brute, index) => {
    const ligne = brute.replace(RE_PREFIXE, '');
    const score = scoreInci(ligne, souple);
    if (score > 0 && (!meilleur || score > meilleur.score))
      meilleur = { index, score, ligne };
  });
  if (!meilleur) return undefined;

  const notes: string[] = [];
  for (const suivante of lignes.slice(meilleur.index + 1, meilleur.index + 4)) {
    if (
      /^[*°¹²(]|agriculture biologique|d'origine naturelle|issus? de|commerce [ée]quitable/i.test(
        suivante,
      ) &&
      suivante.length < 250
    ) {
      notes.push(suivante);
    } else break;
  }
  return { texte: [meilleur.ligne, ...notes].join(' '), score: meilleur.score };
}

const MOTS_INCI =
  /\b(aqua|water|eau|glycerin|glyc[ée]rine|parfum|fragrance|alcohol|alcool|oil|huile|extract|extrait|butter|beurre|acid|sodium|potassium|tocopherol|cetearyl|glyceryl|xanthan|citric|benzoate|sorbate|linalool|limonene|citral|geraniol|coumarin|citronellol|eugenol|butyrospermum|cocos|helianthus|simmondsia|prunus|olea|rosa|lavandula|citrus|caprylic|capric|triglyceride|cera|lecithin|gum|glucoside|betaine|sulfate|chloride|hydroxide|juice|leaf|seed|flower|root|kernel|ci\s?\d{5})\b/gi;
const PROSE =
  /\b(vous|votre|vos|nous|notre|nos|est|sont|permet|gr[aâ]ce|livraison|panier|commande|avis|cookies?|le|la|les|un|une|qui|que|dans|pour|avec|sur|the|your|our|is|are)\b/gi;

/**
 * 0 si le texte ne ressemble pas à une liste d'ingrédients ; plus c'est haut, plus il y ressemble.
 * `souple` : le texte suit un libellé « Ingrédients », on accepte une liste de 1 à 3 éléments.
 */
export function scoreInci(texte: string, souple = false): number {
  if (texte.length < 20 || texte.length > 5000) return 0;
  const segments = texte.split(/[,;]/).filter((s) => s.trim());
  const mots = texte.match(MOTS_INCI)?.length ?? 0;
  const prose = texte.match(PROSE)?.length ?? 0;
  if (segments.length < 4) {
    if (!souple || texte.length > 200 || prose || !mots) return 0;
    return 3 + mots * 2;
  }
  if (texte.length / segments.length > 60 || mots < 2) return 0;
  return Math.min(segments.length, 40) + mots * 2 - prose * 6;
}
