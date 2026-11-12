# scrap · équipe 7 Yaourt

Les crawlers qui fournissent ses sources à l'équipe data : un CSV par source, à déposer dans `data/00_sources/` du dépôt data.

| Jeu                  | Ce qu'on y met                                       | Dossier data                          |
| -------------------- | ---------------------------------------------------- | ------------------------------------- |
| `sites_marques`      | fiches produits : nom, ingrédients, prix, url        | `data/00_sources/sites_marques/`      |
| `rse`                | engagements RSE et communiqués                       | `data/00_sources/rse/`                |
| `actus`              | lancements, nouvelles gammes, rebranding             | `data/00_sources/actus/`              |
| `matieres_premieres` | prix et pénuries des ingrédients naturels (vanille…) | `data/00_sources/matieres_premieres/` |

Colonnes et format : [`docs/contrat-csv.md`](docs/contrat-csv.md). Choix techniques : [ADR 0002](docs/adr/0002-crawlers-typescript-node.md).

## Lancer

```bash
npm ci
npm run crawl -- --liste                                   # les sources configurées
npm run crawl -- cosmebio-marques --limite 10              # essayer une source
npm run crawl -- --tout --sortie ../data/data/00_sources   # tout, directement dans le dépôt data
npm run sonder -- https://www.marque.fr                    # quel crawler brancher sur ce site ?
npm test
```

Options de `crawl` : `--jeu <jeu>`, `--sortie <dossier>` (ou `SCRAP_SORTIE`, défaut `./sortie`), `--limite <n>`, `--cache` (garde les réponses dans `.cache/` pour relancer sans refaire les requêtes).
Pour les sites rendus en JavaScript : `npm run navigateur:installer` une fois, et `SCRAP_CDP_URL=ws://…` pour passer par un navigateur distant (BrightData, Krowler).

## Sources branchées aujourd'hui

`npm run crawl -- --liste` les donne toutes.

- **Produits labellisés [Cosmébio](https://www.cosmebio.org/fr/nos-produits/)** (nom, marque, catégorie, contenance, INCI ; pas de prix) :
  - `cosmebio-marques` : les 11 marques du CRM présentes sur le site, environ 950 fiches, 25 minutes ;
  - `cosmebio-tout` : tout le catalogue, plus de 7 000 fiches, environ 3 heures (essayer avec `--limite`).
- **Fiches produits** de 7 marques dont on a trouvé et sondé le site officiel (`src/sources/sites-marques.ts`, à confirmer avec l'équipe data), avec prix et EAN : Cattier, Florame, Puressentiel, Le Petit Olivier (Shopify), Coslys, Lamazuna, Centifolia (PrestaShop). Les 9 autres marques attendent leur URL exacte.
- **Greenweez** : non branché. Son `robots.txt` autorise `/marque/` et `/produit/`, mais Cloudflare répond 403 à notre crawler, et aux fiches produit même dans un vrai navigateur. On ne contourne pas un blocage.
- **Presse**, indexée par [GDELT](https://www.gdeltproject.org/) et lue dans **BigQuery** (90 jours, recherche dans les titres) :
  - `actus-bigquery` : les articles dont le titre cite une des 16 marques du CRM data (`src/sources/marques.ts`) ;
  - `rse-bigquery` : les mêmes, restreints à ceux qui parlent RSE (titre ou début de l'article) ;
  - `matieres-bigquery` : prix et pénuries de 12 matières premières naturelles (`src/sources/matieres.ts`), presse française et anglaise.
- `actus-presse`, `rse-presse`, `matieres-presse` : les mêmes par l'API DOC de GDELT. Depuis le réseau du hackathon, elle répond 429 même à une requête minimale après 2 minutes de silence (blocage de leur côté, pas du crawler, qui s'arrête après 3 refus d'affilée). Gardées pour un autre réseau.

### BigQuery : la première fois

Les données GDELT sont publiques ; les requêtes sont comptées sur un projet Google Cloud à nous, en bac à sable (gratuit, sans carte bancaire, 1 To lu par mois).

1. `gcloud auth application-default login` (une fois par poste).
2. `GCP_PROJET=<id du projet>` dans `.env` (voir `.env.example`). Projet de l'équipe : `yaourt-scrap-z3yjr`, son propriétaire y ajoute votre compte Google avec le rôle « Utilisateur de job BigQuery » (`roles/bigquery.jobUser`). Ou chacun crée son propre projet en bac à sable.
3. `npm run crawl -- matieres-bigquery --limite 5`.

Une source lit environ 14 Go (90 jours de titres) : les trois ensemble, une quarantaine de Go, soit une vingtaine de passages complets par mois dans le gratuit.
Chaque requête est d'abord simulée ; au-delà de 50 Go, rien n'est envoyé (`plafondOctets` dans `src/crawlers/bigquery.ts`).

## Brancher une source

1. `npm run sonder -- https://www.marque.fr` : plateforme, API publiques, sitemaps, flux RSS, essai de lecture d'une fiche.
2. Ajouter une ligne dans `src/sources/index.ts` avec le crawler générique qu'il propose (exemples en commentaire du fichier).
3. `npm run crawl -- <id> --limite 5`, vérifier le CSV, puis sans `--limite`.

Crawlers génériques (`src/generiques/`), réglés par des options :

| Crawler                    | Pour                                                                  | Jeux                           |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `ShopifyProduits`          | boutique Shopify (`/products.json`)                                   | sites_marques                  |
| `WooCommerceProduits`      | boutique WooCommerce (API Store)                                      | sites_marques                  |
| `FichesProduits`           | tout autre site marchand : sitemap ou listes → fiches (JSON-LD, INCI) | sites_marques                  |
| `FichesProduitsNavigateur` | idem, pages rendues par Chromium                                      | sites_marques                  |
| `WordPressArticles`        | blog ou salle de presse WordPress (`/wp-json/wp/v2/`)                 | rse, actus                     |
| `FluxRss`                  | flux RSS ou Atom                                                      | rse, actus                     |
| `PagesTexte`               | pages éditoriales (« Nos engagements »…), ou listes → articles        | rse, actus                     |
| `GdeltBigQuery`            | presse mondiale (GDELT) dans BigQuery, recherche dans les titres      | actus, rse, matieres_premieres |
| `GdeltArticles`            | presse mondiale par l'API DOC de GDELT                                | actus, rse, matieres_premieres |

Un site qui n'entre dans aucun : une classe dérivée d'une des quatre bases (`src/crawlers/`), rangée dans `src/sites/`, comme dans Malacrawl. Exemple : `src/sites/cosmebio.ts` (HtmlCrawler, sitemap filtré par marque, sélecteurs du site).

## Architecture

```
Crawler (src/core/crawler.ts)        extraire() → lignes ; completer() ligne par ligne (liste → fiche)
├── HtmlCrawler                      fetch + cheerio, parcours en largeur : depart(), analyser(page)
│   └── PlaywrightCrawler            même chose, page rendue par Chromium (ou un navigateur CDP)
├── ApiCrawler                       JSON paginé : premiere(), requete(curseur), analyser(json)
├── RssCrawler                       flux RSS/Atom : flux(), versLigne(item)
└── BigQueryCrawler                  jeu de données BigQuery : requete() → SQL, versLignes(rangée)
```

La base fait le reste : nettoyage, colonnes obligatoires, doublons, `--limite`, date, bilan.
Toutes les requêtes passent par `ClientHttp` (`src/core/http.ts`) : User-Agent du projet, pause par site, `robots.txt` respecté, reprises (avec `Retry-After`), cache disque.
Les extracteurs (`src/extraction/`) ne dépendent d'aucun site : JSON-LD, liste INCI, texte principal, dates, sitemaps, flux, classement par mots-clés.

## Bonnes pratiques

On collecte des données publiques de marques, jamais de données personnelles. Le `robots.txt` de chaque site est respecté : une page refusée est comptée dans la colonne « robots.txt » du bilan, pas contournée. Par défaut, une requête par site toutes les 1,5 s.
