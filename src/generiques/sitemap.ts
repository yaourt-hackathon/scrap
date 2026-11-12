import type { Contexte } from '../core/crawler.ts';
import { lireSitemap } from '../extraction/xml.ts';

/**
 * Les pages d'un site dont l'URL correspond à `motif`, lues dans ses sitemaps
 * (ceux déclarés dans robots.txt, sinon /sitemap.xml, /sitemap_index.xml, /1_index_sitemap.xml).
 * Dans un index, les sitemaps de produits (« product », « produit ») passent en premier.
 */
export async function pagesDuSitemap(
  ctx: Contexte,
  site: string,
  motif: RegExp,
  options: { max?: number; maxSitemaps?: number; depart?: string[] } = {},
): Promise<string[]> {
  const { max = 2000, maxSitemaps = 30 } = options;
  const origine = new URL(site).origin;
  const declares = options.depart ?? (await ctx.http.sitemapsDe(origine));
  // Sans sitemap déclaré : les emplacements habituels (le dernier est celui de PrestaShop).
  const file = declares.length
    ? [...declares]
    : ['/sitemap.xml', '/sitemap_index.xml', '/1_index_sitemap.xml'].map(
        (chemin) => origine + chemin,
      );
  const lus = new Set<string>();
  const pages = new Set<string>();

  while (file.length && lus.size < maxSitemaps && pages.size < max) {
    const url = file.shift()!;
    if (lus.has(url)) continue;
    lus.add(url);
    try {
      const sitemap = lireSitemap((await ctx.http.texte(url)).texte);
      const enfants = sitemap.sitemaps.filter((s) => !lus.has(s));
      const produits = enfants.filter((s) => /produ/i.test(s));
      file.unshift(...produits);
      file.push(...enfants.filter((s) => !/produ/i.test(s)));
      for (const p of sitemap.pages) {
        if (motif.test(p.url)) pages.add(p.url);
        if (pages.size >= max) break;
      }
    } catch (e) {
      // Un site sans /sitemap_index.xml répond 404 : normal, on n'en fait pas une erreur.
      if (declares.length) ctx.journal.erreur(`sitemap ${url}`, e);
    }
  }
  ctx.journal.info(
    `sitemap : ${pages.size} pages retenues sur ${lus.size} sitemaps lus`,
  );
  return [...pages];
}

/** Un motif d'URL donné en texte (« /products/ ») ou en RegExp. */
export function versRegExp(motif: string | RegExp): RegExp {
  return typeof motif === 'string'
    ? new RegExp(motif.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    : motif;
}
