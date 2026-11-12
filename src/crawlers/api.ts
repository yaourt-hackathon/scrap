import { Crawler, type Contexte } from '../core/crawler.ts';
import type { Reponse } from '../core/http.ts';
import type { Jeu, LigneBrute } from '../core/jeux.ts';

export interface RequeteApi {
  url: string;
  init?: RequestInit;
}

/** Ce que rend `analyser()` : les lignes d'une page de résultats, et le curseur de la suivante. */
export interface PageApi<J extends Jeu, C> {
  lignes: LigneBrute<J>[];
  /** `undefined` ou `null` : c'était la dernière page. */
  suivante?: C | null;
}

/**
 * Crawler d'API JSON paginée (Shopify, WooCommerce, WordPress, GDELT…).
 *
 * À écrire dans la classe dérivée :
 * - `premiere(entree)` : le curseur de départ (numéro de page, offset, jeton…) ;
 * - `requete(curseur, entree)` : l'URL (et au besoin méthode, corps, en-têtes) de cette page ;
 * - `analyser(json, curseur, { reponse, entree })` : les lignes, et le curseur suivant.
 *
 * `entrees()` : plusieurs points d'entrée (une requête par marque, par matière…), chacun paginé.
 * Une entrée en erreur est journalisée et n'empêche pas les suivantes.
 */
export abstract class ApiCrawler<
  J extends Jeu,
  C = number,
  E = undefined,
> extends Crawler<J> {
  /** Garde-fou : pages lues au plus, par entrée. */
  protected maxPages = 100;
  /**
   * Coupe-circuit : après autant de requêtes en échec d'affilée (reprises comprises), l'API
   * ne répond plus (quota, panne) ; on arrête la source au lieu d'user les entrées suivantes.
   */
  protected abandonApres = 3;

  protected entrees(): E[] {
    return [undefined as E];
  }

  protected abstract premiere(entree: E): C;
  protected abstract requete(curseur: C, entree: E): string | RequeteApi;
  protected abstract analyser(
    json: unknown,
    curseur: C,
    infos: { reponse: Reponse; entree: E },
  ): PageApi<J, C>;

  protected async *extraire(ctx: Contexte): AsyncGenerator<LigneBrute<J>> {
    const entrees = this.entrees();
    let echecsDeSuite = 0;
    for (const [i, entree] of entrees.entries()) {
      if (echecsDeSuite >= this.abandonApres) {
        ctx.journal.erreur(
          `${echecsDeSuite} requêtes en échec d'affilée : source arrêtée, ${entrees.length - i} entrées non lues`,
        );
        return;
      }
      let curseur: C | null | undefined = this.premiere(entree);
      for (let page = 1; curseur !== null && curseur !== undefined; page++) {
        if (page > this.maxPages) {
          ctx.journal.info(`arrêt à maxPages=${this.maxPages}`);
          break;
        }
        const demande = this.requete(curseur, entree);
        const { url, init } =
          typeof demande === 'string' ? { url: demande, init: {} } : demande;
        let resultat: PageApi<J, C>;
        try {
          const reponse = await ctx.http.texte(url, {
            ...init,
            headers: { accept: 'application/json', ...init?.headers },
          });
          resultat = this.analyser(JSON.parse(reponse.texte), curseur, {
            reponse,
            entree,
          });
        } catch (e) {
          ctx.journal.erreur(url, e);
          echecsDeSuite++;
          break;
        }
        echecsDeSuite = 0;
        if (entrees.length > 1 || page > 1) {
          ctx.journal.info(
            `entrée ${i + 1}/${entrees.length}, page ${page} : ${resultat.lignes.length} lignes`,
          );
        }
        yield* resultat.lignes;
        curseur = resultat.suivante;
      }
    }
  }
}
