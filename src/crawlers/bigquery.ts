import { Crawler, type Contexte } from '../core/crawler.ts';
import type { Jeu, LigneBrute } from '../core/jeux.ts';

export interface RequeteSql {
  sql: string;
  /** Paramètres nommés (`@jours` dans le SQL). */
  params?: Record<string, string | number | boolean>;
}

export type RangeeSql = Record<string, unknown>;

/**
 * Crawler qui lit un jeu de données public dans Google BigQuery (GDELT…), au lieu d'un site ou d'une API.
 *
 * À écrire dans la classe dérivée :
 * - `requete()` : le SQL et ses paramètres ;
 * - `versLignes(rangee)` : une rangée du résultat → zéro, une ou plusieurs lignes.
 *
 * Chaque requête est d'abord simulée (« dry run », gratuite) : si elle lirait plus que `plafondOctets`,
 * on n'envoie rien. La vraie requête porte le même plafond (`maximumBytesBilled`), BigQuery refuse au-delà.
 *
 * Il faut : un projet Google Cloud (`GCP_PROJET` dans `.env`) et des identifiants
 * (`gcloud auth application-default login`). Voir le README.
 */
export abstract class BigQueryCrawler<J extends Jeu> extends Crawler<J> {
  /** 50 Go par requête : 20 requêtes par mois dans le gratuit (1 To). */
  protected plafondOctets = 50e9;

  protected abstract requete(): RequeteSql;
  protected abstract versLignes(rangee: RangeeSql): LigneBrute<J>[];

  protected async *extraire(ctx: Contexte): AsyncGenerator<LigneBrute<J>> {
    const { sql, params } = this.requete();
    for (const rangee of await this.executerSql(sql, params ?? {}, ctx)) {
      yield* this.versLignes(rangee);
    }
  }

  /** Envoie la requête à BigQuery. Les tests la remplacent par des rangées fixes. */
  protected async executerSql(
    sql: string,
    params: Record<string, string | number | boolean>,
    ctx: Contexte,
  ): Promise<RangeeSql[]> {
    const projectId = process.env.GCP_PROJET;
    if (!projectId) {
      throw new Error(
        'GCP_PROJET manquant : le renseigner dans .env (voir .env.example et le README)',
      );
    }
    const { BigQuery } = await import('@google-cloud/bigquery');
    const bigquery = new BigQuery({ projectId });

    const [simulation] = await bigquery.createQueryJob({
      query: sql,
      params,
      dryRun: true,
    });
    const octets = Number(
      simulation.metadata?.statistics?.totalBytesProcessed ?? 0,
    );
    ctx.journal.info(
      `BigQuery : ${(octets / 1e9).toFixed(1)} Go à lire (plafond ${this.plafondOctets / 1e9} Go)`,
    );
    if (octets > this.plafondOctets) {
      throw new Error(
        `requête trop large (${(octets / 1e9).toFixed(1)} Go) : réduire la période ou relever plafondOctets`,
      );
    }

    const debut = Date.now();
    const [rangees] = await bigquery.query({
      query: sql,
      params,
      maximumBytesBilled: String(Math.ceil(this.plafondOctets)),
    });
    ctx.journal.info(
      `BigQuery : ${rangees.length} rangées en ${Math.round((Date.now() - debut) / 1000)} s`,
    );
    return rangees as RangeeSql[];
  }
}
