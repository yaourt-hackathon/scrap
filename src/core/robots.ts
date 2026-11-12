/**
 * Lecture d'un robots.txt : on respecte les règles du groupe qui nous vise, sinon celles de `User-agent: *`.
 * La règle la plus longue qui correspond l'emporte ; à longueur égale, Allow l'emporte (comme Google, RFC 9309).
 */

interface Regle {
  autorise: boolean;
  motif: string;
}

export interface Robots {
  autorise(chemin: string): boolean;
  sitemaps: string[];
}

export function lireRobots(texte: string, agent: string): Robots {
  const groupes: { agents: string[]; regles: Regle[] }[] = [];
  const sitemaps: string[] = [];
  let courant: { agents: string[]; regles: Regle[] } | undefined;
  let dernierEtaitAgent = false;

  for (const brute of texte.split(/\r?\n/)) {
    const ligne = brute.replace(/#.*/, '').trim();
    const deuxPoints = ligne.indexOf(':');
    if (deuxPoints < 0) continue;
    const cle = ligne.slice(0, deuxPoints).trim().toLowerCase();
    const valeur = ligne.slice(deuxPoints + 1).trim();

    if (cle === 'sitemap') {
      if (valeur) sitemaps.push(valeur);
      continue;
    }
    if (cle === 'user-agent') {
      // Plusieurs User-agent qui se suivent partagent le même groupe.
      if (!courant || !dernierEtaitAgent) {
        courant = { agents: [], regles: [] };
        groupes.push(courant);
      }
      courant.agents.push(valeur.toLowerCase());
      dernierEtaitAgent = true;
      continue;
    }
    dernierEtaitAgent = false;
    if (!courant) continue;
    if (cle === 'allow' || cle === 'disallow') {
      // « Disallow: » vide veut dire « tout est permis » : pas de règle.
      if (valeur)
        courant.regles.push({ autorise: cle === 'allow', motif: valeur });
    }
  }

  const jeton = agent.toLowerCase().split('/')[0] ?? '';
  const nous = groupes.filter((g) =>
    g.agents.some((a) => a !== '*' && jeton.startsWith(a)),
  );
  const tous = groupes.filter((g) => g.agents.includes('*'));
  const regles = (nous.length ? nous : tous).flatMap((g) => g.regles);

  return {
    sitemaps,
    autorise(chemin: string) {
      let meilleure: Regle | undefined;
      for (const r of regles) {
        if (!correspond(r.motif, chemin)) continue;
        if (
          !meilleure ||
          r.motif.length > meilleure.motif.length ||
          (r.motif.length === meilleure.motif.length && r.autorise)
        ) {
          meilleure = r;
        }
      }
      return meilleure?.autorise ?? true;
    },
  };
}

/** `*` remplace n'importe quelle suite de caractères, `$` ancre la fin. */
function correspond(motif: string, chemin: string): boolean {
  const ancre = motif.endsWith('$');
  const corps = ancre ? motif.slice(0, -1) : motif;
  const regex = corps
    .split('*')
    .map((morceau) => morceau.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${regex}${ancre ? '$' : ''}`).test(chemin);
}
