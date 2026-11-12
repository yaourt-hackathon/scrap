/**
 * Les crawlers de bout en bout, contre un faux site servi en local : HTTP, robots.txt, sitemaps,
 * reprises, pagination, liste → fiche, doublons. Aucun accès à internet.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Crawler, Journal, type Contexte } from '../core/crawler.ts';
import { ClientHttp } from '../core/http.ts';
import type { LigneBrute } from '../core/jeux.ts';
import { ApiCrawler } from './api.ts';
import {
  FluxRss,
  PagesTexte,
  WordPressArticles,
} from '../generiques/articles.ts';
import { FichesProduits, ShopifyProduits } from '../generiques/produits.ts';
import { CosmebioProduits } from '../sites/cosmebio.ts';

const INCI =
  'Aqua, Glycerin, Cetearyl Alcohol, Parfum, Tocopherol, Linalool, Limonene';

function fiche(nom: string, prix: string): string {
  return `<html><head><link rel="canonical" href="/produit/${nom}">
    <script type="application/ld+json">{"@type":"Product","name":"${nom} 50 ml","offers":{"price":"${prix}","priceCurrency":"EUR"}}</script>
    </head><body><h1>${nom}</h1><h3>Ingrédients</h3><p>${INCI}</p></body></html>`;
}

let server: Server;
let site = '';
let echecs503 = 0;
let appelsPanne = 0;

const pages: Record<string, () => [number, string, string?]> = {
  // Cosmébio, réduit à sa structure (fiche du 2026-11-12).
  '/sitemap-produit.xml': () => [
    200,
    `<urlset><url><loc>${site}/fr/nos-produits/centifolia/huile-de-massage-bebe-15687/</loc></url>
     <url><loc>${site}/fr/nos-produits/autre-marque/creme-1/</loc></url></urlset>`,
  ],
  '/fr/nos-produits/centifolia/huile-de-massage-bebe-15687/': () => [
    200,
    `<nav><a href="/fr/nos-produits/bebe/">Bébé</a></nav>
     <div class="product__categories"><a href="/fr/nos-produits/bebe/soin-du-corps">Soin du corps</a></div>
     <h1>Huile de massage bébé</h1>
     <h2 class="product__marque"><a href="#"><strong>Centifolia</strong></a></h2>
     <a href="#nav-description">Description</a><a href="#nav-ingredients">Ingrédients</a>
     <div id="nav-description"><p><p>Une huile douce pour bébé.</p><p>Flacon verre 100mL</p></p></div>
     <div id="nav-ingredients"><p><p>${INCI}.<br />*Ingrédients issus de l'Agriculture Biologique</p></p></div>`,
  ],
  '/fr/nos-produits/autre-marque/creme-1/': () => [200, '<h1>Crème</h1>'],
  '/robots.txt': () => [
    200,
    `User-agent: *\nDisallow: /prive\nSitemap: ${site}/sitemap_index.xml`,
  ],
  '/sitemap_index.xml': () => [
    200,
    `<sitemapindex><sitemap><loc>${site}/sitemap-pages.xml</loc></sitemap>
     <sitemap><loc>${site}/sitemap-produits.xml</loc></sitemap></sitemapindex>`,
  ],
  '/sitemap-produits.xml': () => [
    200,
    `<urlset><url><loc>${site}/produit/creme</loc></url><url><loc>${site}/produit/savon</loc></url>
     <url><loc>${site}/prive/produit/secret</loc></url><url><loc>${site}/a-propos</loc></url></urlset>`,
  ],
  '/sitemap-pages.xml': () => [
    200,
    `<urlset><url><loc>${site}/a-propos</loc></url></urlset>`,
  ],
  '/produit/creme': () => [200, fiche('creme', '24.90')],
  // Le serveur hoquette une fois : le client doit réessayer.
  '/produit/savon': () =>
    echecs503++ === 0 ? [503, 'occupé'] : [200, fiche('savon', '6,50')],
  '/prive/produit/secret': () => [200, fiche('secret', '1')],
  // Une adresse de départ qui redirige (comme www.marque.fr → marque.fr).
  '/vers-boutique': () => [302, `${site}/boutique`],
  '/boutique': () => [
    200,
    `<a href="/produit/creme">Crème</a><a href="/produit/creme#avis">Crème (avis)</a>
     <a href="/boutique?page=2">2</a><a href="https://ailleurs.fr/produit/x">externe</a>`,
  ],
  '/boutique?page=2': () => [200, `<a href="/produit/savon">Savon</a>`],
  '/products.json?limit=250&page=1': () => [
    200,
    JSON.stringify({
      products: [
        {
          title: 'Baume',
          handle: 'baume',
          product_type: 'Corps',
          body_html: `<p>Un baume.</p><p><strong>INCI :</strong> ${INCI}</p>`,
          variants: [
            {
              title: '30 ml',
              price: '12.00',
              barcode: '3516170021655',
              available: true,
            },
          ],
        },
        {
          title: 'Huile',
          handle: 'huile',
          body_html: '<p>Sans liste ici.</p>',
          variants: [{ price: '9.5' }],
        },
      ],
    }),
    'application/json',
  ],
  '/products/huile': () => [
    200,
    `<h1>Huile</h1><div class="ingredients">Composition : ${INCI}</div>`,
  ],
  '/wp-json/wp/v2/posts?per_page=50&page=1&_fields=link%2Cdate%2Ctitle%2Ccontent%2Cexcerpt':
    () => [
      200,
      JSON.stringify([
        {
          link: `${site}/blog/1`,
          date: '2026-10-01T10:00:00',
          title: { rendered: 'Notre nouvelle gamme &amp; plus' },
          content: { rendered: '<p>Texte.</p>' },
        },
      ]),
      'application/json',
    ],
  '/feed': () => [
    200,
    `<rss><channel><item><title>Engagement B Corp</title><link>${site}/blog/2</link>
     <pubDate>Mon, 09 Nov 2026 08:00:00 GMT</pubDate><description>Nous sommes certifiés.</description></item>
     <item><title>Recette de saison</title><link>${site}/blog/3</link></item></channel></rss>`,
  ],
  '/engagements': () => [
    200,
    `<html><head><meta property="article:published_time" content="2026-09-15T00:00:00Z"></head>
     <body><nav>Menu</nav><main><h1>Nos engagements</h1><p>${'Nous réduisons nos emballages. '.repeat(10)}</p></main></body></html>`,
  ],
};

before(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/api-en-panne')) appelsPanne++;
    const reponse = pages[req.url ?? '']?.();
    if (!reponse) {
      res.writeHead(404).end('introuvable');
      return;
    }
    const [statut, corps, type = 'text/html; charset=utf-8'] = reponse;
    if (statut === 302) {
      res.writeHead(302, { location: corps }).end();
      return;
    }
    res
      .writeHead(statut, { 'content-type': type, 'x-wp-totalpages': '1' })
      .end(corps);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

function contexte(limite?: number): Contexte {
  return {
    http: new ClientHttp({ delaiMs: 5 }),
    journal: new Journal('test'),
    limite,
    aujourdhui: '2026-11-12',
  };
}

describe('FichesProduits', () => {
  it('trouve les fiches par le sitemap, réessaie un 503, respecte robots.txt', async () => {
    const ctx = contexte();
    const bilan = await new FichesProduits('t', {
      marque: 'test',
      site,
      motifFiche: '/produit/',
    }).executer(ctx);
    assert.deepEqual(
      bilan.lignes.map((l) => [
        l.nom,
        l.prix,
        l.devise,
        l.contenance,
        l.ingredients,
        l.url,
      ]),
      [
        ['creme 50 ml', '24.90', 'EUR', '50 ml', INCI, `${site}/produit/creme`],
        ['savon 50 ml', '6.50', 'EUR', '50 ml', INCI, `${site}/produit/savon`],
      ],
    );
    assert.equal(
      bilan.bloquees,
      1,
      'la fiche sous /prive est refusée par robots.txt',
    );
    assert.equal(bilan.erreurs, 0);
    assert.equal(bilan.lignes[0]?.date_scrap, '2026-11-12');
    assert.equal(bilan.lignes[0]?.source, 't');
  });

  it('parcourt les listes, suit la pagination, ignore les liens externes et les fragments', async () => {
    const bilan = await new FichesProduits('t', {
      marque: 'test',
      site,
      listes: [`${site}/boutique`],
      motifFiche: '/produit/',
      motifListe: 'page=',
    }).executer(contexte());
    assert.deepEqual(
      bilan.lignes.map((l) => l.url),
      [`${site}/produit/creme`, `${site}/produit/savon`],
    );
  });

  it('suit les liens du domaine d’arrivée quand le départ redirige', async () => {
    const autreNom = site.replace('127.0.0.1', 'localhost');
    const bilan = await new FichesProduits('t', {
      marque: 'test',
      site: autreNom,
      listes: [`${autreNom}/vers-boutique`],
      motifFiche: '/produit/',
    }).executer(contexte());
    assert.deepEqual(
      bilan.lignes.map((l) => l.url),
      [`${site}/produit/creme`],
    );
  });

  it('s’arrête à la limite', async () => {
    const bilan = await new FichesProduits('t', {
      marque: 'test',
      site,
      motifFiche: '/produit/',
    }).executer(contexte(1));
    assert.equal(bilan.lignes.length, 1);
  });
});

describe('ShopifyProduits', () => {
  it('lit products.json et va chercher les ingrédients manquants sur la fiche', async () => {
    const bilan = await new ShopifyProduits('s', {
      marque: 'test',
      site,
    }).executer(contexte());
    assert.deepEqual(
      bilan.lignes.map((l) => [
        l.nom,
        l.prix,
        l.ean,
        l.contenance,
        l.categorie,
        l.ingredients,
      ]),
      [
        ['Baume', '12.00', '3516170021655', '30 ml', 'Corps', INCI],
        ['Huile', '9.50', '', '', '', INCI],
      ],
    );
  });
});

describe('CosmebioProduits', () => {
  it('lit les fiches des marques demandées, avec leur id CRM', async () => {
    const bilan = await new CosmebioProduits('c', {
      site,
      marques: { centifolia: 'centifolia' },
    }).executer(contexte());
    assert.deepEqual(bilan.lignes, [
      {
        marque: 'centifolia',
        nom: 'Huile de massage bébé',
        categorie: 'Bébé > Soin du corps',
        ingredients: `${INCI}. *Ingrédients issus de l'Agriculture Biologique`,
        contenance: '100 ml',
        url: `${site}/fr/nos-produits/centifolia/huile-de-massage-bebe-15687/`,
        date_scrap: '2026-11-12',
        source: 'c',
      },
    ]);
  });
});

describe('articles', () => {
  it('WordPress : titre décodé, date, texte, type d’actu', async () => {
    const bilan = await new WordPressArticles('w', {
      jeu: 'actus',
      marque: 'test',
      site,
    }).executer(contexte());
    assert.deepEqual(bilan.lignes[0], {
      marque: 'test',
      titre: 'Notre nouvelle gamme & plus',
      date: '2026-10-01',
      url: `${site}/blog/1`,
      texte: 'Texte.',
      type_actu: 'gamme',
      date_scrap: '2026-11-12',
      source: 'w',
    });
  });

  it('RSS avec filtre', async () => {
    const bilan = await new FluxRss('f', {
      jeu: 'rse',
      marque: 'test',
      flux: [`${site}/feed`],
      filtre: /B Corp|engagement/i,
    }).executer(contexte());
    assert.deepEqual(
      bilan.lignes.map((l) => [l.titre, l.date, l.texte]),
      [['Engagement B Corp', '2026-11-09', 'Nous sommes certifiés.']],
    );
  });

  it('pages de texte : titre, date meta, texte principal sans le menu', async () => {
    const bilan = await new PagesTexte('p', {
      jeu: 'rse',
      marque: 'test',
      urls: [`${site}/engagements`],
    }).executer(contexte());
    const ligne = bilan.lignes[0];
    assert.equal(ligne?.titre, 'Nos engagements');
    assert.equal(ligne?.date, '2026-09-15');
    assert.ok(ligne?.texte?.startsWith('Nos engagements\nNous réduisons'));
    assert.ok(!ligne?.texte?.includes('Menu'));
  });
});

describe('Crawler (base)', () => {
  class Factice extends Crawler<'actus'> {
    readonly jeu = 'actus' as const;
    protected async *extraire(): AsyncGenerator<LigneBrute<'actus'>> {
      yield {
        marque: 'm',
        titre: '  Titre  avec   espaces ',
        url: 'https://a.fr/1',
      };
      yield { marque: 'm', titre: 'doublon', url: 'https://a.fr/1' };
      yield { marque: 'm', titre: 'sans url' };
      yield {
        marque: 'autre',
        titre: 'même url, autre marque',
        url: 'https://a.fr/1',
      };
      throw new Error('panne');
    }
  }

  it('nettoie, écarte, dédoublonne, et garde ce qui précède une panne', async () => {
    const bilan = await new Factice('f').executer(contexte());
    assert.deepEqual(
      bilan.lignes.map((l) => l.titre),
      ['Titre avec espaces', 'même url, autre marque'],
    );
    assert.equal(bilan.doublons, 1);
    assert.equal(bilan.ecartees, 1);
    assert.equal(bilan.erreurs, 1);
  });
});

describe('ApiCrawler (base)', () => {
  class EnPanne extends ApiCrawler<'actus', number, string> {
    readonly jeu = 'actus' as const;
    protected override entrees() {
      return ['a', 'b', 'c', 'd', 'e', 'f'];
    }
    protected premiere() {
      return 1;
    }
    protected requete(_page: number, entree: string) {
      return `${site}/api-en-panne?q=${entree}`;
    }
    protected analyser() {
      return { lignes: [] };
    }
  }

  it('arrête la source après 3 requêtes en échec d’affilée', async () => {
    const bilan = await new EnPanne('p').executer(contexte());
    assert.equal(appelsPanne, 3, 'les entrées d, e, f ne sont pas demandées');
    assert.equal(bilan.erreurs, 4, '3 requêtes + l’arrêt');
  });
});
