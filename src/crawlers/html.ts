import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { Crawler, type Contexte } from '../core/crawler.ts';
import type { Jeu, LigneBrute } from '../core/jeux.ts';
import { urlAbsolue } from '../extraction/texte.ts';

/** Une page à visiter. `etiquette` dit à `analyser()` de quel genre de page il s'agit (liste, fiche…). */
export interface Visite {
  url: string;
  etiquette?: string;
}

export interface PageHtml {
  url: string;
  etiquette: string;
  html: string;
  $: CheerioAPI;
}

/** Ce que rend `analyser()` : des lignes et/ou d'autres pages à visiter. */
export interface Analyse<J extends Jeu> {
  lignes?: LigneBrute<J>[];
  suivre?: Array<string | Visite>;
}

/**
 * Crawler de pages HTML (fetch + cheerio, sans navigateur) : l'équivalent des
 * `AbstractHtmlSos*Crawler` de Malacrawl, liste et détail réunis.
 *
 * À écrire dans la classe dérivée :
 * - `depart()` : les premières pages (une liste de produits, un sitemap déjà lu…) ;
 * - `analyser(page)` : les lignes trouvées sur la page, et les liens à suivre.
 *
 * La base parcourt en largeur, ne visite jamais deux fois la même URL, reste sur le domaine
 * de départ (`memeDomaine`) et s'arrête à `maxPages`. Une page en erreur est journalisée, pas fatale.
 */
export abstract class HtmlCrawler<J extends Jeu> extends Crawler<J> {
  protected maxPages = 500;
  protected memeDomaine = true;

  protected abstract depart(
    ctx: Contexte,
  ): Promise<Array<string | Visite>> | Array<string | Visite>;

  protected abstract analyser(
    page: PageHtml,
    ctx: Contexte,
  ): Promise<Analyse<J>> | Analyse<J>;

  /** Télécharge et charge une page. PlaywrightCrawler la remplace par un rendu navigateur. */
  protected async charger(visite: Visite, ctx: Contexte): Promise<PageHtml> {
    const r = await ctx.http.texte(visite.url, {
      headers: { accept: 'text/html,*/*;q=0.8' },
    });
    return {
      url: r.url,
      etiquette: visite.etiquette ?? '',
      html: r.texte,
      $: cheerio.load(r.texte),
    };
  }

  protected async *extraire(ctx: Contexte): AsyncGenerator<LigneBrute<J>> {
    const file: Visite[] = [];
    const vues = new Set<string>();
    const domaines = new Set<string>();
    const ajouter = (lien: string | Visite, base: string, etiquette = '') => {
      const v = typeof lien === 'string' ? { url: lien, etiquette } : lien;
      const url = urlAbsolue(v.url, base);
      if (!url || vues.has(url)) return;
      if (this.memeDomaine && domaines.size && !domaines.has(new URL(url).host))
        return;
      vues.add(url);
      file.push({ ...v, url });
    };

    for (const lien of await this.depart(ctx)) {
      const url = typeof lien === 'string' ? lien : lien.url;
      domaines.add(new URL(url).host);
      ajouter(lien, url);
    }

    let pages = 0;
    while (file.length && pages < this.maxPages) {
      const visite = file.shift()!;
      pages++;
      let analyse: Analyse<J>;
      try {
        const page = await this.charger(visite, ctx);
        // www.marque.fr → marque.fr : le domaine d'arrivée devient aussi « le nôtre ».
        domaines.add(new URL(page.url).host);
        analyse = await this.analyser(page, ctx);
        // Les liens se résolvent depuis l'URL finale (après redirection).
        for (const lien of analyse.suivre ?? []) ajouter(lien, page.url);
      } catch (e) {
        ctx.journal.erreur(visite.url, e);
        continue;
      }
      yield* analyse.lignes ?? [];
    }
    if (file.length) {
      ctx.journal.info(
        `arrêt à maxPages=${this.maxPages}, ${file.length} pages non visitées`,
      );
    }
  }
}
