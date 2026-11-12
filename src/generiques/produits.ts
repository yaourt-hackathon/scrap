import * as cheerio from 'cheerio';
import type { Contexte } from '../core/crawler.ts';
import type { LigneBrute } from '../core/jeux.ts';
import { ApiCrawler } from '../crawlers/api.ts';
import {
  HtmlCrawler,
  type Analyse,
  type PageHtml,
  type Visite,
} from '../crawlers/html.ts';
import { PlaywrightCrawler } from '../crawlers/playwright.ts';
import {
  ingredientsDepuisHtml,
  trouverIngredients,
} from '../extraction/ingredients.ts';
import { produitJsonLd } from '../extraction/json-ld.ts';
import { texteDepuisHtml } from '../extraction/texte.ts';
import {
  contenance,
  ean,
  lireFicheProduit,
  normaliserPrix,
  type SelecteursFiche,
} from './fiche-produit.ts';
import { pagesDuSitemap, versRegExp } from './sitemap.ts';

type LigneProduit = LigneBrute<'sites_marques'>;

/** Ce que tous les crawlers de produits ont en commun. */
export interface OptionsProduits {
  /** Identifiant de la marque, comme dans le CRM de l'équipe data (`melvita`, `so-bio-etic`…). */
  marque: string;
  /** Racine du site : `https://www.marque.fr`. */
  site: string;
  /** Quand l'API ne donne pas les ingrédients, aller les lire sur la fiche produit (1 requête par produit). */
  ingredientsDepuisPage?: boolean;
  selecteurs?: SelecteursFiche;
}

/** Va chercher sur la fiche produit ce que l'API n'a pas donné (ingrédients, EAN). */
async function completerDepuisFiche(
  ligne: LigneProduit,
  ctx: Contexte,
  options: OptionsProduits,
): Promise<LigneProduit> {
  if (
    options.ingredientsDepuisPage === false ||
    ligne.ingredients ||
    !ligne.url
  )
    return ligne;
  const $ = cheerio.load((await ctx.http.texte(ligne.url)).texte);
  return {
    ...ligne,
    ingredients: trouverIngredients($, options.selecteurs?.ingredients),
    ean: ligne.ean || ean(produitJsonLd($)?.ean ?? ''),
  };
}

// ---------------------------------------------------------------- Shopify

interface ProduitShopify {
  title: string;
  handle: string;
  body_html?: string;
  product_type?: string;
  variants?: {
    title?: string;
    price?: string;
    barcode?: string | null;
    available?: boolean;
  }[];
}

export interface OptionsShopify extends OptionsProduits {
  /** Une seule collection (`/collections/<handle>`) au lieu de tout le catalogue. */
  collection?: string;
  /** `products.json` ne donne pas la devise. */
  devise?: string;
}

/**
 * Boutiques Shopify : l'API publique `/products.json` donne tout le catalogue en quelques requêtes.
 * Les ingrédients sont dans la description, ou sinon sur la fiche (voir `ingredientsDepuisPage`).
 */
export class ShopifyProduits extends ApiCrawler<'sites_marques'> {
  readonly jeu = 'sites_marques' as const;
  private readonly options: OptionsShopify;

  constructor(id: string, options: OptionsShopify) {
    super(id);
    this.options = options;
  }

  protected premiere(): number {
    return 1;
  }

  protected requete(page: number): string {
    const { site, collection } = this.options;
    const base = collection
      ? `${site}/collections/${collection}/products.json`
      : `${site}/products.json`;
    return `${base}?limit=250&page=${page}`;
  }

  protected analyser(json: unknown, page: number) {
    const produits = (json as { products?: ProduitShopify[] }).products ?? [];
    const lignes = produits.map((p): LigneProduit => {
      const variante = p.variants?.find((v) => v.available) ?? p.variants?.[0];
      const taille =
        variante?.title && variante.title !== 'Default Title'
          ? variante.title
          : '';
      return {
        marque: this.options.marque,
        nom: p.title,
        ean: ean(variante?.barcode ?? ''),
        categorie: p.product_type ?? '',
        ingredients: ingredientsDepuisHtml(p.body_html ?? ''),
        prix: normaliserPrix(variante?.price),
        devise: variante?.price ? (this.options.devise ?? 'EUR') : '',
        contenance: contenance(taille) || contenance(p.title),
        url: `${this.options.site}/products/${p.handle}`,
      };
    });
    return { lignes, suivante: produits.length === 250 ? page + 1 : null };
  }

  protected override completer(ligne: LigneProduit, ctx: Contexte) {
    return completerDepuisFiche(ligne, ctx, this.options);
  }
}

// ---------------------------------------------------------------- WooCommerce

interface ProduitWoo {
  name: string;
  permalink: string;
  sku?: string;
  description?: string;
  short_description?: string;
  categories?: { name: string }[];
  prices?: {
    price?: string;
    currency_code?: string;
    currency_minor_unit?: number;
  };
}

/** Boutiques WooCommerce : l'API publique Store (`/wp-json/wc/store/v1/products`). */
export class WooCommerceProduits extends ApiCrawler<'sites_marques'> {
  readonly jeu = 'sites_marques' as const;
  private readonly options: OptionsProduits;

  constructor(id: string, options: OptionsProduits) {
    super(id);
    this.options = options;
  }

  protected premiere(): number {
    return 1;
  }

  protected requete(page: number): string {
    return `${this.options.site}/wp-json/wc/store/v1/products?per_page=100&page=${page}`;
  }

  protected analyser(
    json: unknown,
    page: number,
    { reponse }: { reponse: { entetes: Headers } },
  ) {
    const produits = Array.isArray(json) ? (json as ProduitWoo[]) : [];
    const lignes = produits.map((p): LigneProduit => {
      const unite = p.prices?.currency_minor_unit ?? 2;
      const prix = p.prices?.price
        ? Number(p.prices.price) / 10 ** unite
        : undefined;
      const nom = texteDepuisHtml(p.name);
      return {
        marque: this.options.marque,
        nom,
        ean: ean(p.sku ?? ''),
        categorie: (p.categories ?? [])
          .map((c) => texteDepuisHtml(c.name))
          .join(' > '),
        ingredients:
          ingredientsDepuisHtml(p.description ?? '') ||
          ingredientsDepuisHtml(p.short_description ?? ''),
        prix: normaliserPrix(prix),
        devise: prix ? (p.prices?.currency_code ?? '') : '',
        contenance: contenance(nom),
        url: p.permalink,
      };
    });
    const total = Number(reponse.entetes.get('x-wp-totalpages') ?? 0);
    return { lignes, suivante: page < total ? page + 1 : null };
  }

  protected override completer(ligne: LigneProduit, ctx: Contexte) {
    return completerDepuisFiche(ligne, ctx, this.options);
  }
}

// ---------------------------------------------------------------- Fiches HTML (tout site)

export interface OptionsFiches extends OptionsProduits {
  /** Ce qui distingue l'URL d'une fiche produit : `'/products/'`, `/\/p\/\d+/`… */
  motifFiche: string | RegExp;
  /** Pages de liste à parcourir (boutique, catégories). Sans elles, on lit les sitemaps. */
  listes?: string[];
  /** Depuis une liste, les liens de pagination ou de sous-catégories à suivre aussi. */
  motifListe?: string | RegExp;
  maxPages?: number;
}

async function departFiches(
  ctx: Contexte,
  o: OptionsFiches,
): Promise<Visite[]> {
  if (o.listes?.length)
    return o.listes.map((url) => ({ url, etiquette: 'liste' }));
  const pages = await pagesDuSitemap(ctx, o.site, versRegExp(o.motifFiche), {
    max: ctx.limite ? ctx.limite * 2 : undefined,
  });
  return pages.map((url) => ({ url, etiquette: 'fiche' }));
}

function analyserFiches(
  page: PageHtml,
  o: OptionsFiches,
): Analyse<'sites_marques'> {
  const fiche = versRegExp(o.motifFiche);
  if (
    page.etiquette === 'fiche' ||
    (page.etiquette !== 'liste' && fiche.test(page.url))
  ) {
    const ligne = lireFicheProduit(page.$, page.url, o.marque, o.selecteurs);
    return { lignes: ligne ? [ligne] : [] };
  }
  const liens = page
    .$('a[href]')
    .map((_, a) => page.$(a).attr('href') ?? '')
    .get();
  const liste = o.motifListe ? versRegExp(o.motifListe) : undefined;
  return {
    suivre: [
      ...liens
        .filter((h) => fiche.test(h))
        .map((url) => ({ url, etiquette: 'fiche' })),
      ...(liste
        ? liens
            .filter((h) => liste.test(h))
            .map((url) => ({ url, etiquette: 'liste' }))
        : []),
    ],
  };
}

/**
 * N'importe quel site marchand rendu côté serveur (PrestaShop, Magento, WooCommerce sans API, sur-mesure).
 * Trouve les fiches par le sitemap ou par des pages de liste, puis lit chaque fiche (JSON-LD, meta, INCI).
 */
export class FichesProduits extends HtmlCrawler<'sites_marques'> {
  readonly jeu = 'sites_marques' as const;
  private readonly options: OptionsFiches;

  constructor(id: string, options: OptionsFiches) {
    super(id);
    this.options = options;
    if (options.maxPages) this.maxPages = options.maxPages;
  }

  protected depart(ctx: Contexte) {
    return departFiches(ctx, this.options);
  }

  protected analyser(page: PageHtml) {
    return analyserFiches(page, this.options);
  }
}

/** Comme FichesProduits, pour un site qui affiche ses produits en JavaScript. */
export class FichesProduitsNavigateur extends PlaywrightCrawler<'sites_marques'> {
  readonly jeu = 'sites_marques' as const;
  private readonly options: OptionsFiches;

  constructor(id: string, options: OptionsFiches & { attendre?: string }) {
    super(id);
    this.options = options;
    this.attendreSelecteur = options.attendre;
    if (options.maxPages) this.maxPages = options.maxPages;
  }

  protected depart(ctx: Contexte) {
    return departFiches(ctx, this.options);
  }

  protected analyser(page: PageHtml) {
    return analyserFiches(page, this.options);
  }
}
