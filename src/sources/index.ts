import type { Crawler } from '../core/crawler.ts';
import type { Jeu } from '../core/jeux.ts';
import { RE_RSE } from '../extraction/classement.ts';
import { GdeltArticles } from '../generiques/articles.ts';
import { GdeltBigQuery } from '../generiques/gdelt-bigquery.ts';
import { MARQUES, METIER, RSE, requetePresse, titreCite } from './marques.ts';
import { MATIERES, SIGNAL } from './matieres.ts';
import { SITES_MARQUES } from './sites-marques.ts';
import { CosmebioProduits } from '../sites/cosmebio.ts';

/**
 * Le registre des sources : un identifiant → un crawler configuré.
 * Brancher une source = ajouter une ligne ici avec un crawler générique (src/generiques/),
 * ou une classe dérivée de HtmlCrawler / PlaywrightCrawler / ApiCrawler / RssCrawler pour un site particulier.
 * `npm run sonder -- <url>` dit quel crawler générique convient à un site.
 *
 * Le CSV d'une source s'écrit dans `<sortie>/<jeu>/<id>.csv`.
 *
 * Exemples, à copier quand on aura les URL exactes :
 *
 *   'melvita-produits': () => new ShopifyProduits('melvita-produits', { marque: 'melvita', site: 'https://…' }),
 *   'cattier-produits': () => new WooCommerceProduits('cattier-produits', { marque: 'cattier', site: 'https://…' }),
 *   'florame-produits': () => new FichesProduits('florame-produits', {
 *     marque: 'florame', site: 'https://…', motifFiche: /\/produit\//,
 *     selecteurs: { ingredients: '#tab-ingredients' },   // si la détection automatique se trompe
 *   }),
 *   'melvita-rse': () => new PagesTexte('melvita-rse', {
 *     jeu: 'rse', marque: 'melvita', urls: ['https://…/nos-engagements'],
 *   }),
 *   'cattier-blog': () => new WordPressArticles('cattier-blog', { jeu: 'actus', marque: 'cattier', site: 'https://…' }),
 *   'lamazuna-blog': () => new FluxRss('lamazuna-blog', { jeu: 'actus', marque: 'lamazuna', flux: ['https://…/feed'] }),
 */
export const SOURCES: Record<string, () => Crawler<Jeu>> = {
  // Fiches produits des sites officiels (src/sources/sites-marques.ts).
  ...SITES_MARQUES,

  // Produits labellisés Cosmébio des marques du CRM (11 marques sur 16, ~950 fiches, ~25 min).
  'cosmebio-marques': () =>
    new CosmebioProduits('cosmebio-marques', {
      marques: Object.fromEntries(
        MARQUES.map((m) => [m.cosmebio ?? m.id, m.id]),
      ),
    }),

  // Tout le catalogue Cosmébio, pour des exemples de produits (7 000+ fiches, ~3 h : essayer avec --limite).
  'cosmebio-tout': () => new CosmebioProduits('cosmebio-tout'),

  // Presse (GDELT dans BigQuery, 90 jours, ~14 Go lus par source). Il faut GCP_PROJET : voir le README.
  'actus-bigquery': () =>
    new GdeltBigQuery('actus-bigquery', {
      jeu: 'actus',
      // Presse française seulement : en anglais, « cattier » est aussi un adjectif.
      langues: ['french'],
      lireArticles: true,
      cibles: MARQUES.map((m) => ({
        titre: titreCite(m),
        valeurs: { marque: m.id },
      })),
    }),

  'rse-bigquery': () =>
    new GdeltBigQuery('rse-bigquery', {
      jeu: 'rse',
      // Presse française seulement : en anglais, « cattier » est aussi un adjectif.
      langues: ['french'],
      lireArticles: true,
      garderSi: (l) => RE_RSE.test(`${l.titre}\n${l.texte ?? ''}`),
      cibles: MARQUES.map((m) => ({
        titre: titreCite(m),
        valeurs: { marque: m.id },
      })),
    }),

  'matieres-bigquery': () =>
    new GdeltBigQuery('matieres-bigquery', {
      jeu: 'matieres_premieres',
      exigerSignal: true,
      lireArticles: true,
      max: 5000,
      cibles: MATIERES.map(({ matiere, titre, exclure }) => ({
        titre,
        exclure,
        valeurs: { matiere },
      })),
    }),

  // Les mêmes par l'API DOC de GDELT : refusée (429) depuis le réseau du hackathon, voir le README.
  // Presse française : lancements, gammes, rebranding des marques suivies (3 derniers mois).
  'actus-presse': () =>
    new GdeltArticles('actus-presse', {
      jeu: 'actus',
      langues: ['french'],
      requetes: MARQUES.map((m) => ({
        q: requetePresse(m, METIER),
        titre: titreCite(m),
        valeurs: { marque: m.id },
      })),
    }),

  // Presse française : engagements RSE des marques suivies.
  'rse-presse': () =>
    new GdeltArticles('rse-presse', {
      jeu: 'rse',
      langues: ['french'],
      lireArticles: true,
      garderSi: (l) => RE_RSE.test(`${l.titre}\n${l.texte ?? ''}`),
      requetes: MARQUES.map((m) => ({
        q: requetePresse(m, RSE),
        titre: titreCite(m),
        valeurs: { marque: m.id },
      })),
    }),

  // Presse française et anglaise : prix et pénuries des matières premières naturelles.
  'matieres-presse': () =>
    new GdeltArticles('matieres-presse', {
      jeu: 'matieres_premieres',
      max: 100,
      lireArticles: true,
      // Un article sans aucun mot de prix ni de pénurie, même dans son texte, est hors sujet.
      garderSi: (l) => Boolean(l.signal),
      requetes: MATIERES.map(({ matiere, q, titre }) => ({
        q: `${q} ${SIGNAL}`,
        titre,
        valeurs: { matiere },
      })),
    }),
};
