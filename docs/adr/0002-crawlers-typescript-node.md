# 0002. Écrire les crawlers en TypeScript sur Node 24, livrés en CSV

- Statut : proposée
- Date : 2026-11-12
- Décideurs : Maxime

## Contexte

L'équipe data demande des CSV dans `data/00_sources/` : fiches produits des marques, engagements RSE, actus des marques, actus des matières premières. Les sources exactes ne sont pas encore connues : il faut un socle qui accepte vite un nouveau site (HTML, API, page rendue en JavaScript).

Ce dépôt a déjà ESLint, Prettier et une CI Node 24. Le pipeline data est en Python (pandas). On a déjà écrit un crawler multi-sources en TypeScript (Malacrawl, pour Leadbay) : classe de base, dérivations HTML, Playwright et CDP.

## Options

1. TypeScript sur Node 24, sans étape de build (Node exécute le `.ts` directement) : même outillage que le dépôt, reprise des patterns Malacrawl, Playwright natif. Deux langages entre les deux équipes.
2. Python (requests, BeautifulSoup, Scrapy) : même langage que l'équipe data. Le lint et la CI du dépôt ne le vérifient pas, et il faut repartir de zéro.
3. Un service de scraping (Apify, BrightData) : rien à coder pour les cas simples. Payant, et on dépend d'eux pour chaque nouvelle source.

## Décision

Nous choisissons l'option 1. Le contrat entre les équipes est le CSV, pas le langage : les colonnes de chaque jeu sont fixées dans `src/core/jeux.ts` et décrites dans `docs/contrat-csv.md`.

Dépendances : `cheerio` pour lire HTML et XML ; `playwright` seulement pour les sites rendus en JavaScript (chargé à la demande, navigateur à installer à part) ; `typescript` et `@types/node` pour vérifier les types. HTTP, CSV, robots.txt et tests utilisent Node seul (`fetch`, `node:test`).

`@google-cloud/bigquery` pour lire GDELT dans BigQuery, chargé lui aussi à la demande : depuis notre réseau, l'API DOC de GDELT refuse toutes les requêtes (429), alors que BigQuery donne 3 mois de presse en une requête, dans le gratuit d'un projet en bac à sable.

Pas de file de jobs ni de base de données comme dans Malacrawl : les volumes du hackathon (quelques milliers de pages) tiennent en mémoire, un CSV par source.

## Conséquences

- Positives : un nouveau site = une ligne dans `src/sources/index.ts` s'il entre dans un crawler générique, sinon une petite classe dérivée. Même lint, même CI.
- Négatives, à accepter : l'équipe data ne lit pas le code des crawlers dans son langage. Le TypeScript exécuté directement par Node interdit `enum`, `namespace` et les propriétés de paramètres du constructeur (`erasableSyntaxOnly`).
- À revoir si : les volumes dépassent la mémoire, ou si des crawls doivent tourner en continu (il faudrait une file de jobs).
