import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cellule, versCsv } from './csv.ts';
import { lireRobots } from './robots.ts';
import * as cheerio from 'cheerio';
import {
  contenance,
  ean,
  lireFicheProduit,
  normaliserPrix,
} from '../generiques/fiche-produit.ts';

describe('CSV', () => {
  it('met entre guillemets ce qui doit l’être', () => {
    assert.equal(cellule('simple'), 'simple');
    assert.equal(cellule('a, b'), '"a, b"');
    assert.equal(cellule('il dit "oui"'), '"il dit ""oui"""');
    assert.equal(cellule('deux\nlignes'), '"deux\nlignes"');
    assert.equal(cellule(undefined), '');
  });

  it('écrit les colonnes dans l’ordre donné, vides si absentes', () => {
    assert.equal(
      versCsv(['a', 'b'], [{ b: '2' }, { a: '1', c: 'ignorée' }]),
      'a,b\n,2\n1,\n',
    );
  });
});

describe('robots.txt', () => {
  const robots = lireRobots(
    `User-agent: *
Disallow: /
Allow: /$
Allow: /topics/
Sitemap: https://a.fr/sitemap.xml

User-agent: YaourtScrap
User-agent: AutreBot
Disallow: /prive
Allow: /prive/public*.html$`,
    'YaourtScrap/0.1 (test)',
  );

  it('applique le groupe qui nous nomme, pas celui de *', () => {
    assert.equal(robots.autorise('/produits'), true);
    assert.equal(robots.autorise('/prive/x'), false);
    assert.equal(robots.autorise('/prive/public-1.html'), true);
    assert.equal(robots.autorise('/prive/public-1.html?x'), false);
  });

  it('applique * sinon, la règle la plus longue gagnant', () => {
    const autre = lireRobots(
      'User-agent: *\nDisallow: /\nAllow: /$\nAllow: /topics/',
      'Inconnu/1',
    );
    assert.equal(autre.autorise('/'), true);
    assert.equal(autre.autorise('/rss/search?q=x'), false);
    assert.equal(autre.autorise('/topics/abc'), true);
  });

  it('relève les sitemaps, et autorise tout sans robots.txt', () => {
    assert.deepEqual(robots.sitemaps, ['https://a.fr/sitemap.xml']);
    assert.equal(lireRobots('', 'x').autorise('/tout'), true);
  });
});

describe('prix, EAN, contenance', () => {
  it('normalise les prix', () => {
    assert.equal(normaliserPrix('12,90 €'), '12.90');
    assert.equal(normaliserPrix('1 290,00 €'), '1290.00');
    assert.equal(normaliserPrix('1.290,5'), '1290.50');
    assert.equal(normaliserPrix('24.900000'), '24.90');
    assert.equal(normaliserPrix('€ 9'), '9.00');
    assert.equal(normaliserPrix(12.9), '12.90');
    assert.equal(normaliserPrix('gratuit'), '');
  });

  it('ne garde que les EAN valides', () => {
    assert.equal(ean('3516170021655'), '3516170021655');
    assert.equal(ean('3516170021656'), '');
    assert.equal(ean('REF-123'), '');
  });

  it('lit la contenance dans un nom', () => {
    assert.equal(contenance('Crème de jour 50ml'), '50 ml');
    assert.equal(contenance('Savon 100 G'), '100 g');
    assert.equal(contenance('Coffret'), '');
  });
});

describe('fiche produit', () => {
  it('écarte une page de catégorie (ni produit, ni prix, ni ingrédients)', () => {
    const $ = cheerio.load(
      '<h1>Soins visage</h1><a href="/1-creme.html">Crème</a>',
    );
    assert.equal(
      lireFicheProduit($, 'https://a.fr/12-visage.html', 'm'),
      undefined,
    );
  });

  it('lit nom, prix et contenance sans JSON-LD, par les meta', () => {
    const $ =
      cheerio.load(`<head><meta property="product:price:amount" content="7.5">
      <meta property="product:price:currency" content="EUR"></head><h1>Savon 100 g</h1>`);
    const fiche = lireFicheProduit($, 'https://a.fr/p/savon', 'm');
    assert.deepEqual(
      [fiche?.nom, fiche?.prix, fiche?.devise, fiche?.contenance],
      ['Savon 100 g', '7.50', 'EUR', '100 g'],
    );
  });
});
