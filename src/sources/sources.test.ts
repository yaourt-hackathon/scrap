import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FICHE_PRESTASHOP } from './sites-marques.ts';

test('FICHE_PRESTASHOP garde les fiches en français, sans ou avec /fr/, et écarte les autres langues', () => {
  for (const url of [
    'https://www.lamazuna.com/6404-duo-soins-d-hiver.html',
    'https://centifoliabio.fr/fr/coffrets-et-idees-cadeaux/3964-coffret-rose.html',
    'https://www.coslys.fr/fr/corps/345-lait-corps.html',
  ]) {
    assert.ok(FICHE_PRESTASHOP.test(url), url);
  }
  for (const url of [
    'https://www.lamazuna.com/en/6404-winter-duo.html',
    'https://centifoliabio.fr/en/sets-and-gift-ideas/3964-coffret-rose.html',
    'https://www.coslys.fr/es/cuerpo/345-leche.html',
    'https://www.coslys.fr/fr/corps/',
  ]) {
    assert.ok(!FICHE_PRESTASHOP.test(url), url);
  }
});
