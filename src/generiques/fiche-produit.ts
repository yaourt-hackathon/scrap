import type { CheerioAPI } from 'cheerio';
import type { LigneBrute } from '../core/jeux.ts';
import { trouverIngredients } from '../extraction/ingredients.ts';
import { filArianeJsonLd, produitJsonLd } from '../extraction/json-ld.ts';
import { urlAbsolue } from '../extraction/texte.ts';

/** Sélecteurs CSS pour un site où la lecture automatique se trompe. Chacun remplace la détection. */
export interface SelecteursFiche {
  nom?: string;
  prix?: string;
  ingredients?: string;
  ean?: string;
  categorie?: string;
  contenance?: string;
}

/**
 * Lit une fiche produit sans connaître le site : JSON-LD `Product`, balises meta (Open Graph,
 * `product:price`), microdonnées, `<h1>`, puis l'heuristique INCI pour les ingrédients.
 */
export function lireFicheProduit(
  $: CheerioAPI,
  url: string,
  marque: string,
  selecteurs: SelecteursFiche = {},
): LigneBrute<'sites_marques'> | undefined {
  const ld = produitJsonLd($);
  const meta = (nom: string) =>
    $(`meta[property="${nom}"], meta[name="${nom}"]`)
      .first()
      .attr('content')
      ?.trim() ?? '';
  const choisi = (sel?: string) =>
    sel ? $(sel).first().text().replace(/\s+/g, ' ').trim() : '';

  const nom =
    choisi(selecteurs.nom) ||
    ld?.nom ||
    $('h1').first().text().replace(/\s+/g, ' ').trim() ||
    meta('og:title');
  if (!nom) return undefined;

  const prixBrut =
    choisi(selecteurs.prix) ||
    ld?.prix ||
    meta('product:price:amount') ||
    meta('og:price:amount') ||
    ($('[itemprop="price"]').first().attr('content') ?? '');
  const devise =
    ld?.devise ||
    meta('product:price:currency') ||
    meta('og:price:currency') ||
    ($('[itemprop="priceCurrency"]').first().attr('content') ?? '') ||
    (prixBrut.includes('€') ? 'EUR' : '');

  const ingredients = trouverIngredients($, selecteurs.ingredients);
  // Ni JSON-LD Product, ni prix, ni ingrédients : une page de catégorie ou de contenu, pas une fiche.
  if (!ld && !prixBrut && !ingredients && !meta('og:type').includes('product'))
    return undefined;

  const canonique = urlAbsolue($('link[rel="canonical"]').attr('href'), url);
  return {
    marque,
    nom,
    ean: ean(choisi(selecteurs.ean) || ld?.ean || ''),
    categorie:
      choisi(selecteurs.categorie) || ld?.categorie || filArianeJsonLd($),
    ingredients,
    prix: normaliserPrix(prixBrut),
    devise: prixBrut ? devise : '',
    contenance: choisi(selecteurs.contenance) || contenance(nom),
    url: canonique || url,
  };
}

/** « 12,90 € », « 1 290,00 », 12.9 → « 12.90 ». '' si ce n'est pas un prix. */
export function normaliserPrix(brut: string | number | undefined): string {
  if (brut === undefined || brut === '') return '';
  if (typeof brut === 'number') return brut > 0 ? brut.toFixed(2) : '';
  // Format machine (JSON-LD, meta, API) : « 24.9 », « 24.900000 ».
  if (/^\d+(\.\d+)?$/.test(brut.trim())) return normaliserPrix(Number(brut));
  const m = /\d[\d\s\u00a0.,]*/.exec(brut);
  if (!m) return '';
  const s = m[0].replace(/[\s\u00a0]/g, '').replace(/[.,]$/, '');
  // Le dernier séparateur est décimal s'il est suivi de 1 ou 2 chiffres (« 12,9 », « 1.290,00 ») ;
  // suivi de 3 chiffres, c'est un séparateur de milliers (« 1.290 »).
  const dernier = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const decimal = dernier >= 0 && s.length - dernier - 1 <= 2 ? dernier : -1;
  const entier = (decimal >= 0 ? s.slice(0, decimal) : s).replace(/[.,]/g, '');
  const n = Number(decimal >= 0 ? `${entier}.${s.slice(decimal + 1)}` : entier);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
}

/** Un code-barres EAN/GTIN (8, 12, 13 ou 14 chiffres, clé de contrôle juste), sinon ''. */
export function ean(brut: string): string {
  const chiffres = brut.trim();
  if (!/^(\d{8}|\d{12,14})$/.test(chiffres)) return '';
  const corps = [...chiffres.slice(0, -1)].reverse();
  const somme = corps.reduce(
    (s, c, i) => s + Number(c) * (i % 2 === 0 ? 3 : 1),
    0,
  );
  return (10 - (somme % 10)) % 10 === Number(chiffres.at(-1)) ? chiffres : '';
}

/** « Crème de jour 50 ml » → « 50 ml ». */
export function contenance(texte: string): string {
  const m = /(\d+(?:[.,]\d+)?)\s?(ml|cl|l|g|kg|mg)\b/i.exec(texte);
  return m ? `${m[1]} ${m[2]?.toLowerCase()}` : '';
}
