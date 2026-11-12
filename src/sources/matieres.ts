/** Ce qui dit « prix » ou « pénurie » dans un article, en français et en anglais. */
export const SIGNAL =
  '(prix OR pénurie OR récolte OR cours OR flambée OR price OR prices OR shortage OR harvest OR crop OR supply)';

/**
 * Matières premières suivies : termes de recherche pour l'API DOC de GDELT (`q`), et motif que le titre
 * doit contenir, comparé sans accents (`titre`, utilisé aussi tel quel dans le SQL BigQuery). GDELT cherche dans tout le corps des articles, traductions comprises :
 * c'est le titre qui écarte les recettes à la vanille et les « prices rose ».
 * Les expressions exactes (« vanilla prices ») ne ramènent presque rien : on reste sur des mots.
 */
export const MATIERES: {
  matiere: string;
  q: string;
  titre: RegExp;
  /** Écarte les homonymes repérés (« Lemon Tree Hotels », la ville de Cocoa en Floride). */
  exclure?: RegExp;
}[] = [
  { matiere: 'vanille', q: '(vanille OR vanilla)', titre: /vanill/i },
  {
    matiere: 'agrumes',
    q: '(agrumes OR citrus OR citron OR lemon OR "orange juice" OR "jus d\'orange")',
    titre:
      /agrumes?|citrus|citrons?\b|\blemons?\b|orange juice|jus d.orange|\boranges? (harvest|crop|prices?|growers?|production)|pamplemousse|grapefruit/i,
    exclure: /lemon tree hotel|lemonade/i,
  },
  // « bergamo » seul attrape la ville de Bergame.
  { matiere: 'bergamote', q: '(bergamote OR bergamot)', titre: /bergamot/i },
  {
    matiere: 'lavande',
    q: '(lavande OR lavender OR lavandin)',
    titre: /lavand|lavender/i,
  },
  {
    matiere: 'rose',
    q: '("huile de rose" OR "rose oil" OR "rose de Damas" OR "damask rose")',
    titre:
      /\brose(s)?\b.*(huile|oil|damas|damask|grasse|recolte|harvest|parfum|perfume)|(huile|oil|damas|damask|grasse|recolte|harvest|parfum|perfume).*\brose/i,
  },
  {
    matiere: 'jasmin',
    q: '(jasmin OR jasmine)',
    // « Jasmine » est aussi un prénom : il faut la fleur, l'huile, la récolte.
    titre:
      /\bjasmin(e)? (oil|flowers?|absolute|harvest|crop|growers?)\b|\b(huile|fleurs?|absolue|recolte|cueillette) de jasmin/i,
  },
  { matiere: 'patchouli', q: 'patchouli', titre: /patchouli/i },
  { matiere: 'vetiver', q: '(vétiver OR vetiver)', titre: /vetiver/i },
  {
    matiere: 'santal',
    q: '("bois de santal" OR sandalwood)',
    titre: /santal|sandalwood/i,
  },
  {
    matiere: 'ylang-ylang',
    q: '("ylang-ylang" OR "ylang ylang")',
    titre: /ylang/i,
  },
  {
    matiere: 'karite',
    q: '(karité OR "shea butter" OR shea)',
    titre: /karite|\bshea (butter|nuts?)\b/i,
  },
  {
    matiere: 'cacao',
    q: '(cacao OR cocoa)',
    titre: /cacao|cocoa/i,
    exclure: /cocoa beach|cocoa village|in cocoa\b|cocoa,? (fl|florida)\b/i,
  },
];
