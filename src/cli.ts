import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Journal, type Bilan } from './core/crawler.ts';
import { ecrireCsv } from './core/csv.ts';
import { ClientHttp } from './core/http.ts';
import { JEUX, NOMS_JEUX, estJeu, type Jeu } from './core/jeux.ts';
import { SOURCES } from './sources/index.ts';

const AIDE = `Lance les crawlers et écrit un CSV par source dans <sortie>/<jeu>/<source>.csv.

  npm run crawl -- --liste                 les sources configurées
  npm run crawl -- actus-presse            une source (ou plusieurs, séparées par des espaces)
  npm run crawl -- --jeu sites_marques     toutes les sources d'un jeu
  npm run crawl -- --tout                  toutes les sources

Options
  --sortie <dossier>   défaut : $SCRAP_SORTIE, sinon ./sortie
  --limite <n>         s'arrêter après n lignes par source (pour essayer)
  --cache              garder les réponses dans .cache/ et les relire au lancement suivant`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    liste: { type: 'boolean' },
    tout: { type: 'boolean' },
    jeu: { type: 'string' },
    sortie: { type: 'string', default: process.env.SCRAP_SORTIE ?? 'sortie' },
    limite: { type: 'string' },
    cache: { type: 'boolean' },
    aide: { type: 'boolean', short: 'h' },
  },
});

const ids = Object.keys(SOURCES);

if (values.aide) {
  console.log(AIDE);
  process.exit(0);
}

if (values.liste || (!positionals.length && !values.tout && !values.jeu)) {
  console.log('Sources configurées (npm run crawl -- <id>) :\n');
  for (const id of ids)
    console.log(`  ${id.padEnd(28)} → ${SOURCES[id]!().jeu}/`);
  console.log(`\nJeux : ${NOMS_JEUX.join(', ')}`);
  process.exit(0);
}

if (values.jeu && !estJeu(values.jeu)) {
  console.error(
    `Jeu inconnu « ${values.jeu} ». Jeux : ${NOMS_JEUX.join(', ')}`,
  );
  process.exit(2);
}
const inconnues = positionals.filter((id) => !SOURCES[id]);
if (inconnues.length) {
  console.error(
    `Source(s) inconnue(s) : ${inconnues.join(', ')}. Voir npm run crawl -- --liste`,
  );
  process.exit(2);
}

const limite = values.limite ? Number(values.limite) : undefined;
const http = new ClientHttp({
  dossierCache: values.cache ? '.cache' : undefined,
});
const aujourdhui = new Date().toISOString().slice(0, 10);

const choisies = values.tout ? ids : positionals.length ? positionals : ids;
const bilans: (Bilan<Jeu> & { fichier: string })[] = [];

for (const id of choisies) {
  const crawler = SOURCES[id]!();
  if (values.jeu && crawler.jeu !== values.jeu) continue;
  const journal = new Journal(id);
  journal.info(`début → ${crawler.jeu}/`);
  const bilan = await crawler.executer({ http, journal, limite, aujourdhui });

  let fichier = '';
  if (bilan.lignes.length) {
    fichier = join(values.sortie, crawler.jeu, `${id}.csv`);
    await ecrireCsv(fichier, JEUX[crawler.jeu].colonnes, bilan.lignes);
  } else {
    journal.info(
      'aucune ligne : le CSV existant (s’il y en a un) est laissé tel quel',
    );
  }
  journal.info(
    `fin : ${bilan.lignes.length} lignes${fichier ? ` → ${fichier}` : ''}`,
  );
  bilans.push({ ...bilan, fichier });
}

console.log('\nBilan');
console.table(
  bilans.map((b) => ({
    source: b.id,
    lignes: b.lignes.length,
    ecartees: b.ecartees,
    doublons: b.doublons,
    erreurs: b.erreurs,
    'robots.txt': b.bloquees,
    secondes: Math.round(b.duree / 1000),
    fichier: b.fichier || '—',
  })),
);

// Une source qui ne rend rien et a rencontré des erreurs : on le signale par le code de sortie.
if (bilans.some((b) => !b.lignes.length && b.erreurs)) process.exit(1);
