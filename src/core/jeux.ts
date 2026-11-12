/**
 * Les quatre jeux de données livrés à l'équipe data, un dossier chacun dans `data/00_sources/`.
 *
 * `colonnes` fixe l'ordre des colonnes du CSV. `obligatoires` : une ligne sans ces valeurs est écartée.
 * `cle` : deux lignes avec la même clé sont des doublons, on garde la première.
 * `date_scrap` et `source` sont remplies par le crawler de base, jamais par un crawler dérivé.
 *
 * Le contrat de `sites_marques` suit `regles/sites_marques.json` du dépôt data
 * (colonnes obligatoires : marque, nom, ingredients, url, date_scrap).
 */
export const JEUX = {
  sites_marques: {
    colonnes: [
      'marque',
      'nom',
      'ean',
      'categorie',
      'ingredients',
      'prix',
      'devise',
      'contenance',
      'url',
      'date_scrap',
      'source',
    ],
    obligatoires: ['marque', 'nom', 'url'],
    cle: ['url'],
  },
  rse: {
    colonnes: [
      'marque',
      'titre',
      'date',
      'url',
      'texte',
      'date_scrap',
      'source',
    ],
    obligatoires: ['marque', 'titre', 'url'],
    cle: ['marque', 'url'],
  },
  actus: {
    colonnes: [
      'marque',
      'type_actu',
      'titre',
      'date',
      'url',
      'texte',
      'media',
      'langue',
      'date_scrap',
      'source',
    ],
    obligatoires: ['marque', 'titre', 'url'],
    cle: ['marque', 'url'],
  },
  matieres_premieres: {
    colonnes: [
      'matiere',
      'signal',
      'titre',
      'date',
      'url',
      'texte',
      'media',
      'langue',
      'date_scrap',
      'source',
    ],
    obligatoires: ['matiere', 'titre', 'url'],
    cle: ['matiere', 'url'],
  },
} as const;

export type Jeu = keyof typeof JEUX;

export const NOMS_JEUX = Object.keys(JEUX) as Jeu[];

export type Colonne<J extends Jeu> = (typeof JEUX)[J]['colonnes'][number];

/** Une ligne telle qu'écrite dans le CSV. */
export type Ligne<J extends Jeu> = Partial<Record<Colonne<J>, string>>;

/** Ce que produit un crawler dérivé : tout sauf les colonnes remplies par la base. */
export type LigneBrute<J extends Jeu> = Omit<Ligne<J>, 'date_scrap' | 'source'>;

export function estJeu(nom: string): nom is Jeu {
  return nom in JEUX;
}
