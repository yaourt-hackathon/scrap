import type { Crawler } from '../core/crawler.ts';
import { FichesProduits, ShopifyProduits } from '../generiques/produits.ts';

/**
 * Fiches produits des sites officiels, pour les marques dont on a trouvé et sondé le site
 * (`npm run sonder`, 2026-11-12). Sites trouvés par nous : à confirmer avec l'équipe data.
 *
 * Pour 11 marques, les fiches Cosmébio (`cosmebio-marques`) donnent aussi les INCI, sans les prix.
 *
 * Pas encore branchées : Melvita, So'Bio étic, Natessance (renvoie vers leanature.com), Avril
 * (403, protection anti-robots : essayer FichesProduitsNavigateur), Ladrôme, Douce Nature,
 * Laboratoires de Biarritz, Energie Fruit, La Rosée — site exact à trouver.
 */

/**
 * PrestaShop : `/6404-duo-soins-d-hiver.html`, `/fr/corps/345-lait-corps-….html`.
 * En français seulement : les sitemaps listent aussi chaque fiche en `/en/…`, ce qui doublait les produits.
 */
export const FICHE_PRESTASHOP =
  /^https?:\/\/[^/]+\/(?:fr\/)?(?![a-z]{2}\/)(?:[\w-]+\/)*\d+-[\w-]+\.html$/;

export const SITES_MARQUES: Record<string, () => Crawler<'sites_marques'>> = {
  'cattier-produits': () =>
    new ShopifyProduits('cattier-produits', {
      marque: 'cattier',
      site: 'https://www.cattier-paris.com',
    }),
  'florame-produits': () =>
    new ShopifyProduits('florame-produits', {
      marque: 'florame',
      site: 'https://florame.com',
    }),
  'puressentiel-produits': () =>
    new ShopifyProduits('puressentiel-produits', {
      marque: 'puressentiel',
      site: 'https://fr.puressentiel.com',
    }),
  'le-petit-olivier-produits': () =>
    new ShopifyProduits('le-petit-olivier-produits', {
      marque: 'le-petit-olivier',
      site: 'https://lepetitolivier.fr',
    }),
  'coslys-produits': () =>
    new FichesProduits('coslys-produits', {
      marque: 'coslys',
      site: 'https://www.coslys.fr',
      motifFiche: FICHE_PRESTASHOP,
    }),
  'lamazuna-produits': () =>
    new FichesProduits('lamazuna-produits', {
      marque: 'lamazuna',
      site: 'https://www.lamazuna.com',
      motifFiche: FICHE_PRESTASHOP,
    }),
  'centifolia-produits': () =>
    new FichesProduits('centifolia-produits', {
      marque: 'centifolia',
      site: 'https://centifoliabio.fr',
      motifFiche: FICHE_PRESTASHOP,
    }),
};
