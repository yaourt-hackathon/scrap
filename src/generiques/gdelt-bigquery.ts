import type { Contexte } from '../core/crawler.ts';
import type { LigneBrute } from '../core/jeux.ts';
import {
  BigQueryCrawler,
  type RangeeSql,
  type RequeteSql,
} from '../crawlers/bigquery.ts';
import {
  RE_SIGNAL,
  signalMatiere,
  typeActu,
} from '../extraction/classement.ts';
import { dateIso, decoderEntites, sansAccent } from '../extraction/texte.ts';
import {
  lireEtFiltrer,
  type JeuGdelt,
  type OptionsLecture,
} from './articles.ts';

/** Ce qu'on cherche dans les titres, et les colonnes que ça fixe (`{ marque }` ou `{ matiere }`). */
export interface CibleGdelt<J extends JeuGdelt> {
  valeurs: LigneBrute<J>;
  /**
   * Motif testé sur le titre sans accents ni entités HTML. Il part aussi tel quel dans le SQL :
   * syntaxe commune à JavaScript et RE2 (pas de lookahead ni de backreference).
   */
  titre: RegExp;
  /** Titres à écarter malgré tout (homonymes). Appliqué après la requête : peut tout utiliser. */
  exclure?: RegExp;
}

export interface OptionsGdeltBigQuery<
  J extends JeuGdelt,
> extends OptionsLecture<J> {
  jeu: J;
  cibles: CibleGdelt<J>[];
  /** Jours de presse à remonter, 90 par défaut (environ 14 Go lus). */
  jours?: number;
  /** Langues des médias, par défaut français et anglais. */
  langues?: (keyof typeof CODES_LANGUE)[];
  /** Articles au plus (les plus récents). */
  max?: number;
  /** Matières premières : ne garder que les titres qui disent prix ou pénurie. */
  exigerSignal?: boolean;
}

/** `TranslationInfo` de GDELT : vide pour l'anglais, `srclc:fra;…` pour un article traduit. */
const CODES_LANGUE = {
  english: '',
  french: 'fra',
  spanish: 'spa',
  german: 'deu',
  italian: 'ita',
  portuguese: 'por',
} as const;

/**
 * La presse mondiale indexée par GDELT, lue dans BigQuery (`gdelt-bq.gdeltv2.gkg_partitioned`) :
 * pas de quota par requête comme l'API DOC, 3 mois en une requête. On cherche dans les titres.
 */
export class GdeltBigQuery<J extends JeuGdelt> extends BigQueryCrawler<J> {
  readonly jeu: J;
  private readonly options: OptionsGdeltBigQuery<J>;

  constructor(id: string, options: OptionsGdeltBigQuery<J>) {
    super(id);
    this.jeu = options.jeu;
    this.options = options;
  }

  protected requete(): RequeteSql {
    const {
      cibles,
      jours = 90,
      langues = ['french', 'english'],
      max = 3000,
    } = this.options;
    const filtreLangue = langues
      .map((l) => {
        const code = CODES_LANGUE[l];
        return code
          ? `STARTS_WITH(traduction, 'srclc:${code}')`
          : `traduction = ''`;
      })
      .join(' OR ');
    // Les titres arrivent avec leurs accents en entités (« El Ni&#xF1;o ») : décodés et simplifiés
    // par une fonction JavaScript temporaire, pour que les motifs écrits sans accents s'appliquent.
    const sql = String.raw`
      CREATE TEMP FUNCTION simple(s STRING) RETURNS STRING LANGUAGE js AS r"""
        if (s === null) return null;
        return s
          .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
          .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
          .normalize('NFD').replace(/[̀-ͯ]/g, '');
      """;
      WITH articles AS (
        SELECT DATE AS date, SourceCommonName AS media, DocumentIdentifier AS url,
          IFNULL(TranslationInfo, '') AS traduction,
          REGEXP_EXTRACT(Extras, r'<PAGE_TITLE>(.*?)</PAGE_TITLE>') AS titre
        FROM ${'`gdelt-bq.gdeltv2.gkg_partitioned`'}
        WHERE _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @jours DAY)
      )
      SELECT date, media, url, traduction, titre
      FROM articles
      WHERE titre IS NOT NULL
        AND (${filtreLangue})
        AND REGEXP_CONTAINS(simple(titre), @motif)
        ${this.options.exigerSignal ? 'AND REGEXP_CONTAINS(simple(titre), @signal)' : ''}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY url ORDER BY date DESC) = 1
      ORDER BY date DESC
      LIMIT @max`;
    const motif = `(?i)${cibles.map((c) => `(?:${c.titre.source})`).join('|')}`;
    const params: Record<string, string | number> = { jours, motif, max };
    if (this.options.exigerSignal) params['signal'] = `(?i)${RE_SIGNAL.source}`;
    return { sql, params };
  }

  protected versLignes(rangee: RangeeSql): LigneBrute<J>[] {
    const titre = decoderEntites(String(rangee['titre'] ?? '')).trim();
    const simple = sansAccent(titre);
    const traduction = String(rangee['traduction'] ?? '');
    const commun = {
      titre,
      date: dateIso(String(rangee['date'] ?? '')),
      url: String(rangee['url'] ?? ''),
      media: String(rangee['media'] ?? ''),
      langue: langueDe(traduction),
    };
    const lignes: LigneBrute<J>[] = [];
    for (const cible of this.options.cibles) {
      if (!cible.titre.test(simple) || cible.exclure?.test(simple)) continue;
      if (this.jeu === 'matieres_premieres') {
        const signal = signalMatiere(titre);
        if (this.options.exigerSignal && !signal) continue;
        lignes.push({ ...cible.valeurs, ...commun, signal } as LigneBrute<J>);
      } else {
        lignes.push({
          ...cible.valeurs,
          ...commun,
          type_actu: typeActu(titre),
        } as LigneBrute<J>);
      }
    }
    return lignes;
  }

  protected override completer(ligne: LigneBrute<J>, ctx: Contexte) {
    return lireEtFiltrer(this.jeu, ligne, this.options, ctx);
  }
}

function langueDe(traduction: string): string {
  const code = /^srclc:(\w+)/.exec(traduction)?.[1];
  if (!code) return 'english';
  return Object.entries(CODES_LANGUE).find(([, c]) => c === code)?.[0] ?? code;
}
