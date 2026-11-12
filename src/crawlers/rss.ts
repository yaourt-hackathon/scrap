import { Crawler, type Contexte } from '../core/crawler.ts';
import type { Jeu, LigneBrute } from '../core/jeux.ts';
import { lireFlux, type ItemFlux } from '../extraction/xml.ts';

export interface Flux<J extends Jeu> {
  url: string;
  /** Colonnes fixées pour tout ce flux (ex. `{ marque: 'melvita' }`). */
  valeurs?: LigneBrute<J>;
}

/**
 * Crawler de flux RSS / Atom (blog d'une marque, salle de presse, flux d'actualités…).
 *
 * À écrire dans la classe dérivée :
 * - `flux()` : les flux à lire, chacun avec ses colonnes fixes ;
 * - `versLigne(item, flux)` : un article du flux → une ligne, ou `undefined` pour l'ignorer.
 */
export abstract class RssCrawler<J extends Jeu> extends Crawler<J> {
  protected abstract flux(ctx: Contexte): Flux<J>[] | Promise<Flux<J>[]>;
  protected abstract versLigne(
    item: ItemFlux,
    flux: Flux<J>,
  ): LigneBrute<J> | undefined;

  protected async *extraire(ctx: Contexte): AsyncGenerator<LigneBrute<J>> {
    for (const f of await this.flux(ctx)) {
      let items: ItemFlux[];
      try {
        const r = await ctx.http.texte(f.url, {
          headers: {
            accept:
              'application/rss+xml, application/atom+xml, application/xml, */*',
          },
        });
        items = lireFlux(r.texte);
      } catch (e) {
        ctx.journal.erreur(f.url, e);
        continue;
      }
      for (const item of items) {
        const ligne = this.versLigne(item, f);
        if (ligne) yield ligne;
      }
    }
  }
}
