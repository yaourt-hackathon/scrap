/**
 * Classement indicatif par mots-clés, pour trier vite. Ce n'est pas une vérité :
 * l'équipe data (ou le LLM) peut reclasser à partir du titre et du texte.
 */

/** Ce qui signale un engagement RSE (labels, emballages, carbone, biodiversité…). */
export const RE_RSE =
  /\bRSE\b|B ?Corp|entreprise à mission|engagements?|durable|durabilit[ée]|recycl|biodiversit[ée]|carbone|empreinte|[ée]co-?con[cç]|commerce [ée]quitable|z[ée]ro d[ée]chet|vrac|sustainab/i;

const TYPES_ACTU: [string, RegExp][] = [
  [
    'rebranding',
    /rebranding|nouvelle (identit[ée]|image|signature)|nouveau (logo|nom|packaging|design)|change(nt)? de nom|relooking|refonte/i,
  ],
  [
    'rachat',
    /rachat|rach[eè]t|acquisition|acquiert|cession|\bc[eè]de\b|fusion|lev[ée]e de fonds/i,
  ],
  ['gamme', /nouvelle gamme|gamme|collection|ligne de (soins|produits)/i],
  [
    'lancement',
    /lanc(e|ement|ent)|nouveau(t[ée])?|nouvelle|in[ée]dit|d[ée]voile|arrive|sortie/i,
  ],
  ['rse', RE_RSE],
];

/** `rebranding`, `rachat`, `gamme`, `lancement`, `rse`, ou '' : le premier qui ressort, dans cet ordre. */
export function typeActu(texte: string): string {
  return TYPES_ACTU.find(([, re]) => re.test(texte))?.[0] ?? '';
}

// Mots entiers seulement : « cher » ne doit pas sortir de « researchers ».
const SIGNAUX: [string, RegExp][] = [
  [
    'penurie',
    /\b(p[ée]nuries?|raret[ée]|ruptures?|manques?|tensions?|shortages?|scarcity|supply (crunch|issues?)|r[ée]coltes?|harvests?|s[ée]cheresses?|droughts?|cyclones?|gel|frost|inondations?|floods?|flooding|maladies?|diseases?|output|production)\b/i,
  ],
  [
    'prix',
    /\b(prix|cours|flamb[ée]e|hausses?|baisses?|envol[ée]e|ch[eè]re?s?|tarifs?|inflation|co[uû]ts?|prices?|costs?|surges?|soar(s|ing)?|spikes?|plunges?|record)\b/i,
  ],
];

/** Tous les signaux en un seul motif (utilisable aussi en SQL BigQuery, syntaxe RE2). */
export const RE_SIGNAL = new RegExp(
  SIGNAUX.map(([, re]) => `(?:${re.source})`).join('|'),
  'i',
);

/** `penurie`, `prix`, `penurie+prix`, ou ''. */
export function signalMatiere(texte: string): string {
  return SIGNAUX.filter(([, re]) => re.test(texte))
    .map(([nom]) => nom)
    .join('+');
}
