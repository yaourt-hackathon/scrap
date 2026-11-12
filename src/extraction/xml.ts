import * as cheerio from 'cheerio';
import { dateIso } from './texte.ts';

/** Contenu d'un sitemap : soit d'autres sitemaps (index), soit des pages. */
export interface Sitemap {
  sitemaps: string[];
  pages: { url: string; lastmod: string }[];
}

export function lireSitemap(xml: string): Sitemap {
  const $ = cheerio.load(xml, { xml: true });
  return {
    sitemaps: $('sitemapindex > sitemap > loc')
      .map((_, el) => $(el).text().trim())
      .get(),
    pages: $('urlset > url')
      .map((_, el) => ({
        url: $(el).children('loc').text().trim(),
        lastmod: dateIso($(el).children('lastmod').text()),
      }))
      .get()
      .filter((p) => p.url),
  };
}

export interface ItemFlux {
  titre: string;
  lien: string;
  date: string;
  /** Résumé, en HTML le plus souvent. */
  description: string;
  /** Contenu complet si le flux le donne (`content:encoded`, Atom `content`). */
  contenu: string;
  /** Média d'origine quand le flux l'indique (`<source>`). */
  media: string;
}

/** Les articles d'un flux RSS 2.0 ou Atom. */
export function lireFlux(xml: string): ItemFlux[] {
  const $ = cheerio.load(xml, { xml: true });
  const rss = $('item')
    .map((_, el) => {
      const item = $(el);
      return {
        titre: item.children('title').text().trim(),
        lien:
          item.children('link').text().trim() ||
          item.children('guid').text().trim(),
        date: dateIso(
          item.children('pubDate').text() || item.children('dc\\:date').text(),
        ),
        description: item.children('description').text().trim(),
        contenu: item.children('content\\:encoded').text().trim(),
        media: item.children('source').text().trim(),
      };
    })
    .get();
  if (rss.length) return dedoublonner(rss);

  return $('feed > entry')
    .map((_, el) => {
      const entree = $(el);
      const lien =
        entree.children('link[rel="alternate"]').attr('href') ??
        entree.children('link').first().attr('href') ??
        '';
      return {
        titre: entree.children('title').text().trim(),
        lien: lien.trim(),
        date: dateIso(
          entree.children('published').text() ||
            entree.children('updated').text(),
        ),
        description: entree.children('summary').text().trim(),
        contenu: entree.children('content').text().trim(),
        media: entree.children('source').children('title').text().trim(),
      };
    })
    .get();
}

function dedoublonner(items: ItemFlux[]): ItemFlux[] {
  const vus = new Set<string>();
  return items.filter((i) => !vus.has(i.lien) && vus.add(i.lien));
}
