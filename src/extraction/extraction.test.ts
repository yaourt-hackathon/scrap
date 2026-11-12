import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as cheerio from 'cheerio';
import { signalMatiere, typeActu } from './classement.ts';
import {
  ingredientsDepuisHtml,
  scoreInci,
  trouverIngredients,
} from './ingredients.ts';
import { filArianeJsonLd, produitJsonLd } from './json-ld.ts';
import { dateIso, texteDepuisHtml, tronquer, urlAbsolue } from './texte.ts';
import { lireFlux, lireSitemap } from './xml.ts';

const INCI =
  'Aqua (Water), Glycerin, Butyrospermum Parkii (Shea) Butter*, Cetearyl Alcohol, Parfum (Fragrance), Tocopherol, Linalool, Limonene';

describe('ingrédients', () => {
  it('trouve la liste après un titre « Ingrédients »', () => {
    const $ = cheerio.load(`
      <h2>Description</h2><p>Une crème douce pour vous, avec notre beurre de karité.</p>
      <h3>Ingrédients</h3><p>${INCI}</p>
      <p>*Ingrédients issus de l'agriculture biologique</p>`);
    assert.equal(
      trouverIngredients($),
      `${INCI} *Ingrédients issus de l'agriculture biologique`,
    );
  });

  it('lit un onglet caché relié par aria-controls', () => {
    const $ = cheerio.load(`
      <button aria-controls="onglet-3">Composition</button>
      <div id="onglet-3" aria-hidden="true"><div><p>${INCI}</p></div></div>`);
    assert.equal(trouverIngredients($), INCI);
  });

  it('retire le libellé quand il est dans le même paragraphe', () => {
    assert.equal(
      ingredientsDepuisHtml(`<p><strong>Ingrédients :</strong> ${INCI}</p>`),
      INCI,
    );
  });

  it("retire « LISTE D'INGREDIENTS : » en capitales", () => {
    assert.equal(
      ingredientsDepuisHtml(`<p>LISTE D'INGREDIENTS : ${INCI}</p>`),
      INCI,
    );
  });

  it('trouve une liste sans libellé, et ignore la prose', () => {
    const html = `<p>Livraison offerte, retours gratuits, paiement sécurisé, avis clients.</p><div>${INCI}</div>`;
    assert.equal(ingredientsDepuisHtml(html), INCI);
  });

  it('accepte un ingrédient unique, seulement après un libellé', () => {
    const seul = 'Butyrospermum Parkii (Shea) Butter*';
    assert.equal(
      ingredientsDepuisHtml(`<h4>Ingrédients</h4><p>${seul}</p>`),
      seul,
    );
    assert.equal(ingredientsDepuisHtml(`<h4>Conseils</h4><p>${seul}</p>`), '');
  });

  it('ne prend pas une phrase de description pour une liste', () => {
    const html = `<p>Le beurre de karité bio est un soin multi-usages riche, nourrissant, pour le visage, le corps et les cheveux.</p>`;
    assert.equal(ingredientsDepuisHtml(html), '');
  });

  it("rend '' quand la page n'a pas de liste", () => {
    assert.equal(
      ingredientsDepuisHtml('<p>Une crème, douce, légère, parfumée.</p>'),
      '',
    );
    assert.equal(
      scoreInci(
        'Nous livrons, vous profitez, votre panier, notre boutique, vos avis',
      ),
      0,
    );
  });

  it('respecte un sélecteur donné', () => {
    const $ = cheerio.load(
      `<div class="inci">${INCI}</div><p>${INCI}, Citral</p>`,
    );
    assert.equal(trouverIngredients($, '.inci'), INCI);
  });
});

describe('JSON-LD', () => {
  const page = cheerio.load(`
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"BreadcrumbList","itemListElement":[
        {"position":1,"name":"Accueil"},{"position":2,"name":"Visage"},{"position":3,"name":"Crèmes"},{"position":4,"name":"Crème rose"}]},
      {"@type":"Product","name":"Crème rose","gtin13":"3516170021655","category":"Soin visage",
       "brand":{"@type":"Brand","name":"Florame"},"alternateName":"x",
       "description":"Fleur d&#039;oranger",
       "offers":{"@type":"Offer","price":"24.90","priceCurrency":"EUR"}}]}</script>
    <script type="application/ld+json">{ cassé </script>`);

  it('lit le produit dans un @graph, malgré un bloc invalide', () => {
    const p = produitJsonLd(page);
    assert.equal(p?.nom, 'Crème rose');
    assert.equal(p?.ean, '3516170021655');
    assert.equal(p?.prix, '24.90');
    assert.equal(p?.devise, 'EUR');
    assert.equal(p?.marque, 'Florame');
    assert.equal(p?.description, "Fleur d'oranger");
  });

  it("lit le fil d'Ariane sans l'accueil ni le produit", () => {
    assert.equal(filArianeJsonLd(page), 'Visage > Crèmes');
  });
});

describe('texte et dates', () => {
  it('garde un paragraphe par ligne et retire les menus', () => {
    const html =
      '<nav>Menu</nav><p>Un <b>premier</b> paragraphe.</p><p>Deuxième<br>ligne</p><script>x()</script>';
    assert.equal(
      texteDepuisHtml(html),
      'Un premier paragraphe.\nDeuxième\nligne',
    );
  });

  it('lit les formats de date courants', () => {
    assert.equal(dateIso('2026-11-10T13:35:31+01:00'), '2026-11-10');
    assert.equal(dateIso('Tue, 10 Nov 2026 08:00:00 GMT'), '2026-11-10');
    assert.equal(dateIso('20261110T123000Z'), '2026-11-10');
    assert.equal(dateIso('20261110123000'), '2026-11-10');
    assert.equal(dateIso('10/11/2026'), '2026-11-10');
    assert.equal(dateIso('1er décembre 2026'), '2026-12-01');
    assert.equal(dateIso('pas une date'), '');
  });

  it('tronque sur un mot', () => {
    assert.equal(tronquer('un deux trois quatre', 12), 'un deux …');
  });

  it('rend des URL absolues sans fragment, et refuse le reste', () => {
    assert.equal(urlAbsolue('/p/1#avis', 'https://a.fr/x'), 'https://a.fr/p/1');
    assert.equal(urlAbsolue('mailto:a@b.fr', 'https://a.fr'), '');
  });
});

describe('XML', () => {
  it('lit un index de sitemaps et un sitemap de pages', () => {
    const index = lireSitemap(
      '<sitemapindex><sitemap><loc>https://a.fr/sitemap_products_1.xml</loc></sitemap></sitemapindex>',
    );
    assert.deepEqual(index.sitemaps, ['https://a.fr/sitemap_products_1.xml']);
    const pages = lireSitemap(
      '<urlset><url><loc>https://a.fr/products/creme</loc><lastmod>2026-10-01</lastmod></url></urlset>',
    );
    assert.deepEqual(pages.pages, [
      { url: 'https://a.fr/products/creme', lastmod: '2026-10-01' },
    ]);
  });

  it('lit un flux RSS et un flux Atom', () => {
    const rss =
      lireFlux(`<rss><channel><item><title>Nouvelle gamme</title><link>https://a.fr/1</link>
      <pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;Résumé&lt;/p&gt;</description>
      <source url="https://media.fr">Le Média</source></item></channel></rss>`);
    assert.equal(rss[0]?.titre, 'Nouvelle gamme');
    assert.equal(rss[0]?.date, '2026-11-10');
    assert.equal(rss[0]?.description, '<p>Résumé</p>');
    assert.equal(rss[0]?.media, 'Le Média');

    const atom =
      lireFlux(`<feed><entry><title>Article</title><link rel="alternate" href="https://a.fr/2"/>
      <published>2026-11-09T10:00:00Z</published><summary>Court</summary></entry></feed>`);
    assert.deepEqual(
      [atom[0]?.titre, atom[0]?.lien, atom[0]?.date],
      ['Article', 'https://a.fr/2', '2026-11-09'],
    );
  });
});

describe('classement', () => {
  it('classe les actus', () => {
    assert.equal(typeActu('Melvita dévoile un nouveau logo'), 'rebranding');
    assert.equal(typeActu('Cattier lance une nouvelle gamme solaire'), 'gamme');
    assert.equal(typeActu('Le groupe rachète Coslys'), 'rachat');
    assert.equal(typeActu('Florame obtient le label B Corp'), 'rse');
    assert.equal(typeActu('Interview du dirigeant'), '');
  });

  it('repère prix et pénurie', () => {
    assert.equal(
      signalMatiere('Vanilla prices soar after cyclone'),
      'penurie+prix',
    );
    assert.equal(signalMatiere('La récolte de lavande en berne'), 'penurie');
    assert.equal(signalMatiere('Un salon à Grasse'), '');
    assert.equal(signalMatiere('Florida researchers test a citrus mesh'), '');
  });
});
