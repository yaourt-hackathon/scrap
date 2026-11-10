# 0001. Vérifier le code avec ESLint et Prettier avant chaque commit

- Statut : acceptée
- Date : 2026-11-09
- Décideurs : Maxime

## Contexte

Plusieurs développeurs travaillent dans le même dépôt. Sans règles communes, les diffs se remplissent de formatage et les revues portent sur la forme.

## Options

1. ESLint + Prettier + husky/lint-staged : outils standards, presets prêts à l'emploi. Quatre dépendances.
2. Biome : un seul outil, rapide. Moins de règles et de plugins.
3. Vérification en CI seulement : rien à installer. L'erreur n'apparaît qu'après le push.

## Décision

Nous choisissons ESLint + Prettier, lancés par lint-staged au pre-commit, parce que les erreurs sont corrigées avant d'arriver dans une PR.

## Conséquences

- Positives : un seul style, des diffs sans bruit.
- Négatives, à accepter : le hook se contourne avec `--no-verify` (la CI revérifie).
- À revoir si : le hook devient trop lent.
