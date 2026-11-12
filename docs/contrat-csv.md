# Contrat CSV avec l'équipe data

Chaque source écrit un fichier `<sortie>/<jeu>/<source>.csv`, à poser dans `data/00_sources/<jeu>/` du dépôt data.
Le fichier d'une source est remplacé à chaque passage, pour éviter les doublons d'un passage à l'autre. Une source qui ne rend rien ne touche pas au fichier existant.

Format : UTF-8, virgule, guillemets RFC 4180, fins de ligne `\n`. Une cellule vide est une valeur inconnue. Les dates sont au format `AAAA-MM-JJ`.
L'ordre des colonnes est fixé dans `src/core/jeux.ts`.

Colonnes communes, remplies par le crawler de base :

| Colonne      | Contenu                                                      |
| ------------ | ------------------------------------------------------------ |
| `date_scrap` | jour de la collecte                                          |
| `source`     | identifiant de la source (`npm run crawl -- --liste`)        |
| `marque`     | identifiant de la marque, comme dans le CRM data (`melvita`) |

## `sites_marques` : fiches produits

Suit `regles/sites_marques.json` du dépôt data (obligatoires : `marque`, `nom`, `ingredients`, `url`, `date_scrap`).

| Colonne       | Contenu                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------- |
| `nom`         | nom du produit                                                                           |
| `ean`         | code-barres, seulement s'il a une clé de contrôle valide (sinon vide)                    |
| `categorie`   | type de produit ou fil d'Ariane (`Visage > Crèmes`)                                      |
| `ingredients` | liste INCI telle qu'affichée, avec la note `*issus de l'agriculture biologique` qui suit |
| `prix`        | prix affiché, point décimal (`24.90`)                                                    |
| `devise`      | `EUR`…                                                                                   |
| `contenance`  | `50 ml`, `100 g`, lue dans le nom ou la variante                                         |
| `url`         | URL canonique de la fiche                                                                |

Selon la source, des colonnes restent vides : Cosmébio ne donne ni `prix`, ni `devise`, ni `ean` ; un site de marque, si.
`ingredients` vient d'une détection automatique. Une ligne peut l'avoir vide : le silver du dépôt data l'écarte alors (`sans_ingredients`), et le prix reste dans le bronze.
`prix` et `devise` ne sont pas encore dans le `mapping_silver` de `regles/sites_marques.json`.

## `rse` : engagements et communiqués

| Colonne | Contenu                                                  |
| ------- | -------------------------------------------------------- |
| `titre` | titre de la page ou de l'article                         |
| `date`  | date de publication, vide si la page n'en donne pas      |
| `url`   | adresse de la page                                       |
| `texte` | texte principal, un paragraphe par ligne, sans les menus |

## `actus` : lancements, gammes, rebranding

Colonnes de `rse`, plus :

| Colonne     | Contenu                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `type_actu` | `rebranding`, `rachat`, `gamme`, `lancement`, `rse` ou vide. Classement par mots-clés, indicatif |
| `media`     | domaine du média pour la presse (`lsa-conso.fr`), vide pour le site de la marque                 |
| `langue`    | langue du média (`french`, `english`)                                                            |

## `matieres_premieres` : prix et pénuries

Colonnes de `actus`, sans `marque` ni `type_actu`, plus :

| Colonne   | Contenu                                                                |
| --------- | ---------------------------------------------------------------------- |
| `matiere` | `vanille`, `agrumes`, `bergamote`, `lavande`… (`src/sources/index.ts`) |
| `signal`  | `prix`, `penurie`, `penurie+prix`. Classement par mots-clés, indicatif |

Pour la presse, `texte` est le début de l'article (1 500 caractères au plus), pas l'article entier : de quoi citer la source, et le lien pour la lire.
