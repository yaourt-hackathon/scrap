import { sansAccent } from '../extraction/texte.ts';

/**
 * Les marques suivies. `id` = la colonne `marque` du CRM de l'équipe data
 * (`data/00_sources/crm/marques_comptes_fictif.csv` dans le dépôt data) : c'est la clé de jointure.
 *
 * `presse` : comment nommer la marque dans une recherche GDELT. Par défaut son nom entre guillemets ;
 * à préciser pour les homonymes (« Avril » le mois…). Le sujet (métier, RSE) s'ajoute derrière.
 */
export interface Marque {
  id: string;
  nom: string;
  presse?: string;
  /** Le nom de la marque dans les URL de cosmebio.org, s'il diffère de `id`. */
  cosmebio?: string;
  /** Motif du titre (sans accents) quand le nom seul est un mot courant (« avril », « la rosée »). */
  titre?: RegExp;
}

export const MARQUES: Marque[] = [
  { id: 'florame', nom: 'Florame' },
  { id: 'cattier', nom: 'Cattier' },
  { id: 'melvita', nom: 'Melvita' },
  {
    id: 'so-bio-etic',
    cosmebio: 'sobio-etic',
    nom: "So'Bio étic",
    presse: '("So Bio etic" OR "SoBio etic" OR "So\'Bio")',
  },
  { id: 'centifolia', nom: 'Centifolia' },
  { id: 'natessance', nom: 'Natessance' },
  { id: 'lamazuna', nom: 'Lamazuna' },
  { id: 'coslys', nom: 'Coslys' },
  { id: 'douce-nature', nom: 'Douce Nature' },
  {
    id: 'avril',
    nom: 'Avril',
    presse: '("Avril Beauté" OR "cosmétiques Avril" OR "marque Avril")',
    titre:
      /\bavril (beaute|cosmetiques?|bio)\b|\bcosmetiques? avril\b|\bmarque avril\b/i,
  },
  {
    id: 'laboratoires-de-biarritz',
    nom: 'Laboratoires de Biarritz',
    cosmebio: 'laboratoires-de-biarritz-france',
  },
  { id: 'le-petit-olivier', nom: 'Le Petit Olivier' },
  { id: 'puressentiel', nom: 'Puressentiel' },
  { id: 'energie-fruit', nom: 'Energie Fruit' },
  {
    id: 'la-rosee',
    nom: 'La Rosée',
    titre:
      /\bla rosee (cosmetiques?|soins?)\b|\bcosmetiques? la rosee\b|\bmarque la rosee\b/i,
  },
  { id: 'ladrome', nom: 'Ladrôme', cosmebio: 'ladrome-laboratoire' },
];

/** Le contexte métier ajouté au nom, pour écarter les articles hors sujet. */
export const METIER = '(cosmétique OR cosmétiques OR beauté OR soin OR soins)';
export const RSE =
  '(RSE OR engagement OR engagements OR durable OR environnement OR "B Corp" OR recyclable OR biodiversité OR "entreprise à mission")';

export function requetePresse(m: Marque, sujet = METIER): string {
  return `${m.presse ?? `"${m.nom}"`} ${sujet}`;
}

/** Le nom de la marque dans un titre (comparé sans accents ni casse). */
export function titreCite(m: Marque): RegExp {
  if (m.titre) return m.titre;
  return new RegExp(
    `\\b${sansAccent(m.nom).replace(/[^a-z0-9]+/gi, '.?')}`,
    'i',
  );
}
