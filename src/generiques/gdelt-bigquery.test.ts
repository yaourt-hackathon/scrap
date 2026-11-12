import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Journal, type Contexte } from '../core/crawler.ts';
import { ClientHttp } from '../core/http.ts';
import type { RangeeSql } from '../crawlers/bigquery.ts';
import { MARQUES, titreCite } from '../sources/marques.ts';
import { MATIERES } from '../sources/matieres.ts';
import { GdeltBigQuery, type OptionsGdeltBigQuery } from './gdelt-bigquery.ts';

/** La source, avec des rangées fixes à la place de BigQuery. */
class Factice<
  J extends 'actus' | 'matieres_premieres',
> extends GdeltBigQuery<J> {
  sql = '';
  params: Record<string, unknown> = {};
  private readonly rangees: RangeeSql[];
  constructor(options: OptionsGdeltBigQuery<J>, rangees: RangeeSql[]) {
    super('f', options);
    this.rangees = rangees;
  }
  protected override async executerSql(
    sql: string,
    params: Record<string, unknown>,
  ) {
    this.sql = sql;
    this.params = params;
    return this.rangees;
  }
}

const ctx = (): Contexte => ({
  http: new ClientHttp({ delaiMs: 0 }),
  journal: new Journal('test'),
  aujourdhui: '2026-11-12',
});

const rangee = (
  titre: string,
  traduction = '',
  url = `https://m.fr/${titre.length}`,
) => ({
  date: 20261110123000,
  media: 'm.fr',
  url,
  traduction,
  titre,
});

describe('GdeltBigQuery', () => {
  it('construit le SQL : période, langues, motif de toutes les cibles', async () => {
    const source = new Factice(
      {
        jeu: 'actus',
        jours: 30,
        cibles: MARQUES.slice(0, 2).map((m) => ({
          titre: titreCite(m),
          valeurs: { marque: m.id },
        })),
      },
      [],
    );
    await source.executer(ctx());
    assert.match(
      source.sql,
      /STARTS_WITH\(traduction, 'srclc:fra'\) OR traduction = ''/,
    );
    assert.match(source.sql, /gdelt-bq\.gdeltv2\.gkg_partitioned/);
    assert.equal(source.params['jours'], 30);
    assert.equal(source.params['motif'], '(?i)(?:\\bFlorame)|(?:\\bCattier)');
  });

  it('actus : titre décodé, marque reconnue sans accents, langue et date', async () => {
    const source = new Factice(
      {
        jeu: 'actus',
        cibles: MARQUES.map((m) => ({
          titre: titreCite(m),
          valeurs: { marque: m.id },
        })),
      },
      [
        rangee(
          'Ladr&#xF4;me lance une nouvelle gamme',
          'srclc:fra;eng:GT-FRA 1.0',
        ),
        rangee('Les cosm&#xE9;tiques Avril arrivent en pharmacie'),
        rangee('Rendez-vous le 3 avril'),
      ],
    );
    const bilan = await source.executer(ctx());
    assert.deepEqual(
      bilan.lignes.map((l) => [
        l.marque,
        l.titre,
        l.date,
        l.langue,
        l.type_actu,
      ]),
      [
        [
          'ladrome',
          'Ladrôme lance une nouvelle gamme',
          '2026-11-10',
          'french',
          'gamme',
        ],
        [
          'avril',
          'Les cosmétiques Avril arrivent en pharmacie',
          '2026-11-10',
          'english',
          'lancement',
        ],
      ],
    );
  });

  it('matières : une ligne par matière citée, seulement avec un signal de prix ou de pénurie', async () => {
    const source = new Factice(
      {
        jeu: 'matieres_premieres',
        exigerSignal: true,
        cibles: MATIERES.map(({ matiere, titre, exclure }) => ({
          titre,
          exclure,
          valeurs: { matiere },
        })),
      },
      [
        rangee('Cocoa and vanilla prices soar after cyclone'),
        rangee('Vanilla latte returns to the menu'),
        rangee('Bergamo : hausse des prix des loyers'),
        rangee('Lemon Tree Hotels shares surge 7%'),
      ],
    );
    const bilan = await source.executer(ctx());
    assert.deepEqual(
      bilan.lignes.map((l) => [l.matiere, l.signal]),
      [
        ['vanille', 'penurie+prix'],
        ['cacao', 'penurie+prix'],
      ],
    );
  });
});
