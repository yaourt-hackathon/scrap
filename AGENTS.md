# AGENTS.md

Présentation du projet : `README.md`. La stack applicative n'est pas encore choisie : n'en suppose aucune.

## Lancer

- `npm ci` : installe depuis `package-lock.json`, comme la CI.
- Avant de dire « fini » : `npm run lint` puis `npm run format:check`. Ce sont les contrôles du job `qualite` (`.github/workflows/ci.yml`, conteneur `node:24-trixie`).
- `npm run format` corrige la forme.

## Règles

- Une branche par tâche, depuis `develop` (`feature/…`, `conf/…`, `docs/…`). La PR vise `develop` et suit `.github/pull_request_template.md`.
- Une commande se définit une seule fois, dans `scripts` de `package.json`. La CI et la doc l'appellent (`npm run lint`), elles ne la recopient pas.
- Un outil, une responsabilité : le code dans `eslint.config.mjs`, la forme dans `.prettierrc.json`. Aucune règle de forme dans ESLint (`eslint-config-prettier` les coupe).
- Le hook `.husky/pre-commit` lance lint-staged sur les fichiers indexés. Sa config est dans `package.json`.
- Le plan d'une tâche vit dans son ticket (`gh issue view N`). Les brouillons vont dans `.scratch/`, ignoré par git.

## Décisions

- Lis `docs/adr/` avant d'ajouter une dépendance ou de changer d'outil.
- ESLint + Prettier, pas Biome (ADR 0001).
- Ne contredis pas un ADR « acceptée ». S'il faut en changer, propose un nouvel ADR, puis arrête-toi.

## À ne pas faire

- `git commit --no-verify` ou `eslint-disable` pour faire passer un contrôle.
- Recopier ici le contenu du README, des ADR ou de la CI : renvoie vers le fichier.
- Créer un `TASKS.md` ou un journal commité.
