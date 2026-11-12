import type { Contexte } from '../core/crawler.ts';
import type { LigneBrute } from '../core/jeux.ts';
import {
  HtmlCrawler,
  type Analyse,
  type PageHtml,
  type Visite,
} from '../crawlers/html.ts';
import { trouverIngredients } from '../extraction/ingredients.ts';
import { slug, texteDe } from '../extraction/texte.ts';
import { contenance } from '../generiques/fiche-produit.ts';
import { pagesDuSitemap } from '../generiques/sitemap.ts';

const SITE = 'https://www.cosmebio.org';
/** Toutes les fiches, en français : `/fr/nos-produits/<marque>/<produit>-<id>/`. */
const FICHE = /\/fr\/nos-produits\/([\w-]+)\/[\w-]+-\d+\/$/;

/** Le conditionnement en fin de description : « Flacon verre 100mL », « Tube 50 ml ». */
const CONDITIONNEMENT =
  /^(flacon|tube|pot|stick|bo[iî]te|sachet|spray|roll-on|bouteille|recharge|pompe|airless|bidon|pain|vaporisateur)\b/i;

export interface OptionsCosmebio {
  /**
   * Les marques à lire : nom dans l'URL Cosmébio → `marque` écrite dans le CSV (id du CRM data).
   * Sans cette option, tout le catalogue (plus de 7 000 fiches, plusieurs heures).
   */
  marques?: Record<string, string>;
  /** Pour les tests : un autre serveur que cosmebio.org. */
  site?: string;
}

/**
 * Les produits labellisés Cosmébio (cosmebio.org) : nom, marque, catégorie, contenance et liste INCI.
 * Pas de prix ni d'EAN sur ce site : l'association ne vend pas.
 *
 * Exemple de crawler dédié à un site : HtmlCrawler, sélecteurs propres au site, sitemap pour les URL.
 */
export class CosmebioProduits extends HtmlCrawler<'sites_marques'> {
  readonly jeu = 'sites_marques' as const;
  protected override maxPages = 10_000;
  private readonly options: OptionsCosmebio;

  constructor(id: string, options: OptionsCosmebio = {}) {
    super(id);
    this.options = options;
  }

  protected async depart(ctx: Contexte): Promise<Visite[]> {
    const { marques, site = SITE } = this.options;
    const sitemap = `${site}/sitemap-produit.xml`;
    const fiches = (
      await pagesDuSitemap(ctx, site, FICHE, {
        depart: [sitemap],
        max: 100_000,
      })
    ).filter(
      (url) => !marques || Object.hasOwn(marques, FICHE.exec(url)?.[1] ?? ''),
    );
    ctx.journal.info(`${fiches.length} fiches à lire`);
    return fiches.map((url) => ({ url, etiquette: 'fiche' }));
  }

  protected analyser(page: PageHtml): Analyse<'sites_marques'> {
    const { $ } = page;
    const nom = $('h1').first().text().replace(/\s+/g, ' ').trim();
    if (!nom) return {};

    const dansUrl = FICHE.exec(page.url)?.[1] ?? '';
    const affichee = $('.product__marque')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const marque = this.options.marques?.[dansUrl] ?? slug(affichee || dansUrl);

    // « /fr/nos-produits/bebe/soin-du-corps » → « Bébé > Soin du corps » (libellé du menu).
    const sousCategorie = $('.product__categories a').first();
    const rayon = /\/fr\/nos-produits\/([\w-]+)\//.exec(
      sousCategorie.attr('href') ?? '',
    )?.[1];
    const libelleRayon = rayon
      ? $(`a[href="/fr/nos-produits/${rayon}/"]`).first().text().trim()
      : '';
    const categorie = [libelleRayon, sousCategorie.text().trim()]
      .filter(Boolean)
      .join(' > ');

    const description = texteDe($, $('#nav-description').first(), false).split(
      '\n',
    );
    const conditionnement =
      description.find((l) => CONDITIONNEMENT.test(l)) ?? '';

    const ligne: LigneBrute<'sites_marques'> = {
      marque,
      nom,
      categorie,
      ingredients: trouverIngredients($, '#nav-ingredients'),
      contenance: contenance(conditionnement) || contenance(nom),
      url: page.url,
    };
    return { lignes: [ligne] };
  }
}
