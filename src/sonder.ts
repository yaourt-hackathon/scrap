/**
 * npm run sonder -- https://www.marque.fr [https://…]
 *
 * Regarde un site et dit quel crawler générique lui brancher : plateforme (Shopify, WooCommerce,
 * PrestaShop…), API publiques ouvertes, sitemaps, flux RSS, et l'essai de lecture d'une fiche produit.
 * Quelques requêtes par site, robots.txt respecté.
 */
import * as cheerio from 'cheerio';
import { Journal, type Contexte } from './core/crawler.ts';
import { ClientHttp } from './core/http.ts';
import { lireFicheProduit } from './generiques/fiche-produit.ts';
import { pagesDuSitemap } from './generiques/sitemap.ts';
import { urlAbsolue } from './extraction/texte.ts';

const PLATEFORMES: [string, RegExp][] = [
  ['Shopify', /cdn\.shopify\.com|Shopify\.theme/],
  ['WooCommerce', /woocommerce/i],
  ['PrestaShop', /prestashop/i],
  ['Magento', /Magento|mage\/cookies|static\/version\d+/],
  ['Salesforce Commerce Cloud', /demandware/i],
  ['Wix', /static\.wixstatic\.com|wix\.com/],
  ['Squarespace', /squarespace/i],
  ['WordPress', /wp-content|wp-json/],
];

/** Les URL qui ressemblent à des fiches produit, toutes plateformes confondues. */
const RESSEMBLE_FICHE =
  /\/products?\/|\/produits?\/|\/p\/|-p-?\d+|\/\d+-[^/]+\.html$|\.html$/i;

const sites = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!sites.length) {
  console.log('Usage : npm run sonder -- https://www.marque.fr [https://…]');
  process.exit(2);
}

const http = new ClientHttp({ delaiMs: 1000 });

for (const brut of sites) {
  const demande = new URL(brut.includes('://') ? brut : `https://${brut}`)
    .origin;
  const ctx: Contexte = {
    http,
    journal: new Journal('sonder'),
    aujourdhui: '',
    limite: undefined,
  };
  console.log(`\n== ${demande}`);
  await sonder(demande, ctx).catch((e) =>
    console.log(`  échec : ${e instanceof Error ? e.message : e}`),
  );
}

async function sonder(demande: string, ctx: Contexte): Promise<void> {
  const accueil = await http.texte(demande);
  // Après redirection (www → sans www, fr.marque.com…), c'est l'adresse finale qui compte.
  const site = new URL(accueil.url).origin;
  const $ = cheerio.load(accueil.texte);
  const plateformes = PLATEFORMES.filter(([, re]) =>
    re.test(accueil.texte),
  ).map(([nom]) => nom);
  const generateur = $('meta[name="generator"]').attr('content') ?? '';
  const texteVisible = $('body').text().replace(/\s+/g, ' ').trim().length;
  ligne(
    'accueil',
    `${accueil.statut} « ${$('title').text().trim().slice(0, 70)} »`,
  );
  if (site !== demande) ligne('', `redirigé vers ${site}`);
  ligne(
    'plateforme',
    [...plateformes, generateur].filter(Boolean).join(', ') || 'non reconnue',
  );
  if (texteVisible < 800)
    ligne(
      '',
      `peu de texte dans le HTML (${texteVisible} car.) : contenu en JavaScript ?`,
    );

  const sitemaps = await http.sitemapsDe(site);
  ligne(
    'robots.txt',
    sitemaps.length
      ? `${sitemaps.length} sitemap(s) : ${sitemaps.slice(0, 3).join(' ')}`
      : 'aucun sitemap déclaré',
  );

  const shopify = await essai(`${site}/products.json?limit=1`, (j) =>
    Array.isArray((j as { products?: unknown }).products),
  );
  const woo = await essai(
    `${site}/wp-json/wc/store/v1/products?per_page=1`,
    Array.isArray,
  );
  const wp = await essai(
    `${site}/wp-json/wp/v2/posts?per_page=1`,
    Array.isArray,
  );
  ligne('API Shopify', shopify ? 'oui (/products.json)' : 'non');
  ligne('API WooCommerce', woo ? 'oui (/wp-json/wc/store/v1/products)' : 'non');
  ligne('API WordPress', wp ? 'oui (/wp-json/wp/v2/posts)' : 'non');

  const flux = $(
    'link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]',
  )
    .map((_, l) => urlAbsolue($(l).attr('href'), accueil.url))
    .get()
    .filter(Boolean);
  ligne('flux RSS', flux.length ? flux.join(' ') : '—');

  // Une fiche produit pour voir ce que la lecture automatique en tire.
  let exemples = await pagesDuSitemap(ctx, site, RESSEMBLE_FICHE, {
    max: 20,
    maxSitemaps: 6,
  });
  if (!exemples.length) {
    exemples = $('a[href]')
      .map((_, a) => urlAbsolue($(a).attr('href'), accueil.url))
      .get()
      .filter((u) => u.startsWith(site) && RESSEMBLE_FICHE.test(u));
  }
  const exemple = exemples.find((u) => /produ/i.test(u)) ?? exemples[0];
  if (exemple) {
    const fiche = lireFicheProduit(
      cheerio.load((await http.texte(exemple)).texte),
      exemple,
      '?',
    );
    ligne('fiche essayée', exemple);
    ligne(
      '',
      fiche
        ? [
            `nom ${marque(fiche.nom)}`,
            `prix ${marque(fiche.prix && `${fiche.prix} ${fiche.devise}`)}`,
            `ean ${marque(fiche.ean)}`,
            `ingrédients ${marque(fiche.ingredients?.slice(0, 60))}`,
          ].join('  ')
        : 'rien lu (pas de nom)',
    );
  } else {
    ligne('fiche essayée', 'aucune URL de fiche trouvée');
  }

  ligne(
    '→ à brancher',
    suggestion(site, {
      shopify,
      woo,
      wp,
      flux,
      exemple,
      js: texteVisible < 800,
    }),
  );
}

function suggestion(
  site: string,
  s: {
    shopify: boolean;
    woo: boolean;
    wp: boolean;
    flux: string[];
    exemple?: string;
    js: boolean;
  },
): string {
  const lignes: string[] = [];
  if (s.shopify)
    lignes.push(`new ShopifyProduits(id, { marque, site: '${site}' })`);
  else if (s.woo)
    lignes.push(`new WooCommerceProduits(id, { marque, site: '${site}' })`);
  else if (s.exemple) {
    const classe = s.js ? 'FichesProduitsNavigateur' : 'FichesProduits';
    lignes.push(
      `new ${classe}(id, { marque, site: '${site}', motifFiche: ${motifDe(s.exemple)} })`,
    );
  }
  if (s.wp)
    lignes.push(
      `new WordPressArticles(id, { jeu: 'actus', marque, site: '${site}' })`,
    );
  else if (s.flux.length)
    lignes.push(
      `new FluxRss(id, { jeu: 'actus', marque, flux: ['${s.flux[0]}'] })`,
    );
  lignes.push(
    `new PagesTexte(id, { jeu: 'rse', marque, urls: ['<page engagements>'] })`,
  );
  return lignes.join('\n' + ' '.repeat(20));
}

/** Le motif d'URL des fiches, deviné depuis un exemple. */
function motifDe(exemple: string): string {
  const dossier = /\/products?\/|\/produits?\//i.exec(exemple)?.[0];
  if (dossier) return `'${dossier}'`;
  // PrestaShop : /6404-duo-soins-d-hiver.html
  if (/\/\d+-[^/]+\.html$/.test(exemple)) return '/\\/\\d+-[\\w-]+\\.html$/';
  return "'à préciser'";
}

async function essai(
  url: string,
  valide: (json: unknown) => boolean,
): Promise<boolean> {
  try {
    return valide(await http.json(url));
  } catch {
    return false;
  }
}

function marque(valeur: string | undefined): string {
  return valeur ? `✔ ${valeur}` : '—';
}

function ligne(cle: string, valeur: string): void {
  console.log(`  ${cle.padEnd(16)}  ${valeur}`);
}
