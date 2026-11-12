import type { CheerioAPI } from 'cheerio';
import { decoderEntites } from './texte.ts';

type Objet = Record<string, unknown>;

/** Tous les objets schema.org des balises JSON-LD d'une page, `@graph` et tableaux aplatis. */
export function objetsJsonLd($: CheerioAPI): Objet[] {
  const objets: Objet[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const brut = $(el).text().trim();
    if (!brut) return;
    try {
      // Certains sites laissent des retours chariot ou tabulations bruts dans les chaînes.
      aplatir(JSON.parse(brut.replace(/[\n\r\t]+/g, ' ')), objets);
    } catch {
      // JSON-LD invalide : on l'ignore, les autres sources de la page prendront le relais.
    }
  });
  return objets;
}

function aplatir(valeur: unknown, sortie: Objet[]): void {
  if (Array.isArray(valeur)) {
    for (const v of valeur) aplatir(v, sortie);
  } else if (valeur && typeof valeur === 'object') {
    const objet = valeur as Objet;
    sortie.push(objet);
    if (objet['@graph']) aplatir(objet['@graph'], sortie);
  }
}

export function aLeType(objet: Objet, type: string): boolean {
  const t = objet['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

export interface ProduitJsonLd {
  nom: string;
  ean: string;
  sku: string;
  categorie: string;
  description: string;
  prix: string;
  devise: string;
  marque: string;
  url: string;
}

/** Le premier `Product` (ou `ProductGroup`) de la page, ramené à des chaînes simples. */
export function produitJsonLd($: CheerioAPI): ProduitJsonLd | undefined {
  const objets = objetsJsonLd($);
  const produit =
    objets.find((o) => aLeType(o, 'Product')) ??
    objets.find((o) => aLeType(o, 'ProductGroup'));
  if (!produit) return undefined;

  const variante = premier(produit['hasVariant']) as Objet | undefined;
  const offre = (premier(produit['offers']) ??
    premier(variante?.['offers'])) as Objet | undefined;
  const specification = premier(offre?.['priceSpecification']) as
    Objet | undefined;

  return {
    nom: chaine(produit['name']),
    ean: chaine(
      produit['gtin13'] ??
        produit['gtin'] ??
        produit['gtin14'] ??
        produit['gtin12'] ??
        produit['gtin8'] ??
        variante?.['gtin13'] ??
        variante?.['gtin'],
    ),
    sku: chaine(produit['sku'] ?? variante?.['sku']),
    categorie: chaine(produit['category']),
    description: chaine(produit['description']),
    prix: chaine(
      offre?.['price'] ?? offre?.['lowPrice'] ?? specification?.['price'],
    ),
    devise: chaine(
      offre?.['priceCurrency'] ?? specification?.['priceCurrency'],
    ),
    marque: chaine(
      (premier(produit['brand']) as Objet | undefined)?.['name'] ??
        produit['brand'],
    ),
    url: chaine(produit['url'] ?? offre?.['url']),
  };
}

/** Le fil d'Ariane (`BreadcrumbList`) sans l'accueil ni la page elle-même : « Visage > Crèmes ». */
export function filArianeJsonLd($: CheerioAPI): string {
  const fil = objetsJsonLd($).find((o) => aLeType(o, 'BreadcrumbList'));
  const elements = Array.isArray(fil?.['itemListElement'])
    ? (fil['itemListElement'] as Objet[])
    : [];
  const noms = elements
    .slice()
    .sort((a, b) => Number(a['position'] ?? 0) - Number(b['position'] ?? 0))
    .map((e) =>
      chaine(e['name'] ?? (e['item'] as Objet | undefined)?.['name']),
    );
  return noms.slice(1, -1).filter(Boolean).join(' > ');
}

/** La date de publication d'un article (`Article`, `NewsArticle`, `BlogPosting`…). */
export function datePublicationJsonLd($: CheerioAPI): string {
  for (const o of objetsJsonLd($)) {
    const d = o['datePublished'] ?? o['dateCreated'];
    if (typeof d === 'string' && d) return d;
  }
  return '';
}

function premier(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function chaine(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return decoderEntites(v).trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(chaine).filter(Boolean).join(', ');
  if (typeof v === 'object' && 'name' in v) return chaine((v as Objet)['name']);
  return '';
}
