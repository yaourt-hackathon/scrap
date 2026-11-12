import * as cheerio from 'cheerio';
import type { Contexte } from '../core/crawler.ts';
import type { LigneBrute } from '../core/jeux.ts';
import { ApiCrawler } from '../crawlers/api.ts';
import { HtmlCrawler, type Analyse, type PageHtml } from '../crawlers/html.ts';
import { RssCrawler, type Flux } from '../crawlers/rss.ts';
import { signalMatiere, typeActu } from '../extraction/classement.ts';
import { datePublicationJsonLd } from '../extraction/json-ld.ts';
import {
  dateIso,
  sansAccent,
  texteDepuisHtml,
  textePrincipal,
  tronquer,
} from '../extraction/texte.ts';
import type { ItemFlux } from '../extraction/xml.ts';
import { versRegExp } from './sitemap.ts';

/** Les jeux faits d'articles venant d'une marque : engagements RSE, actualités. */
export type JeuArticle = 'rse' | 'actus';
type LigneArticle = LigneBrute<JeuArticle>;

/** `type_actu` n'a de sens que pour les actus. */
function article(jeu: JeuArticle, ligne: LigneArticle): LigneArticle {
  if (jeu === 'actus')
    return {
      ...ligne,
      type_actu: typeActu(`${ligne.titre} ${ligne.texte ?? ''}`),
    };
  return ligne;
}

// ---------------------------------------------------------------- WordPress

export interface OptionsWordPress {
  jeu: JeuArticle;
  marque: string;
  site: string;
  /** Recherche plein texte côté WordPress (`search=`), ex. « engagement ». */
  recherche?: string;
  /** Identifiants de catégories WordPress (`/wp-json/wp/v2/categories` pour les trouver). */
  categories?: number[];
  /** `posts` (articles, par défaut) ou `pages`. */
  type?: 'posts' | 'pages';
  /** Ne garder que les articles dont le titre ou le texte correspond. */
  filtre?: RegExp;
}

interface ArticleWordPress {
  link: string;
  date?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
}

/** Le blog ou la salle de presse d'un site WordPress, par l'API REST publique `/wp-json/wp/v2/`. */
export class WordPressArticles extends ApiCrawler<JeuArticle> {
  readonly jeu: JeuArticle;
  private readonly options: OptionsWordPress;

  constructor(id: string, options: OptionsWordPress) {
    super(id);
    this.jeu = options.jeu;
    this.options = options;
  }

  protected premiere(): number {
    return 1;
  }

  protected requete(page: number): string {
    const { site, type = 'posts', recherche, categories } = this.options;
    const params = new URLSearchParams({
      per_page: '50',
      page: String(page),
      _fields: 'link,date,title,content,excerpt',
    });
    if (recherche) params.set('search', recherche);
    if (categories?.length) params.set('categories', categories.join(','));
    return `${site}/wp-json/wp/v2/${type}?${params}`;
  }

  protected analyser(
    json: unknown,
    page: number,
    { reponse }: { reponse: { entetes: Headers } },
  ) {
    const articles = Array.isArray(json) ? (json as ArticleWordPress[]) : [];
    const lignes = articles
      .map((a) =>
        article(this.jeu, {
          marque: this.options.marque,
          titre: texteDepuisHtml(a.title?.rendered ?? ''),
          date: dateIso(a.date),
          url: a.link,
          texte: texteDepuisHtml(
            a.content?.rendered || a.excerpt?.rendered || '',
          ),
        }),
      )
      .filter(
        (l) =>
          !this.options.filtre ||
          this.options.filtre.test(`${l.titre}\n${l.texte}`),
      );
    const total = Number(reponse.entetes.get('x-wp-totalpages') ?? 0);
    return { lignes, suivante: page < total ? page + 1 : null };
  }
}

// ---------------------------------------------------------------- Flux RSS / Atom

export interface OptionsFluxRss {
  jeu: JeuArticle;
  marque: string;
  /** Les flux : `https://www.marque.fr/feed/`, `/blog.atom`… */
  flux: string[];
  filtre?: RegExp;
}

/** Les flux RSS ou Atom d'une marque (blog, actualités, salle de presse). */
export class FluxRss extends RssCrawler<JeuArticle> {
  readonly jeu: JeuArticle;
  private readonly options: OptionsFluxRss;

  constructor(id: string, options: OptionsFluxRss) {
    super(id);
    this.jeu = options.jeu;
    this.options = options;
  }

  protected flux(): Flux<JeuArticle>[] {
    return this.options.flux.map((url) => ({
      url,
      valeurs: { marque: this.options.marque },
    }));
  }

  protected versLigne(
    item: ItemFlux,
    flux: Flux<JeuArticle>,
  ): LigneArticle | undefined {
    const texte = texteDepuisHtml(item.contenu || item.description);
    if (
      this.options.filtre &&
      !this.options.filtre.test(`${item.titre}\n${texte}`)
    )
      return undefined;
    return article(this.jeu, {
      ...flux.valeurs,
      titre: item.titre,
      date: item.date,
      url: item.lien,
      texte,
      media: item.media,
    });
  }
}

// ---------------------------------------------------------------- Pages de texte

export interface OptionsPagesTexte {
  jeu: JeuArticle;
  marque: string;
  /** Les pages à lire (« Nos engagements », « Communiqués »…). */
  urls: string[];
  /** Si les pages de départ sont des listes : le motif des liens d'articles à suivre. */
  motifArticle?: string | RegExp;
  /** Le bloc de texte à lire, si `<article>` / `<main>` ne conviennent pas. */
  selecteurTexte?: string;
  maxPages?: number;
}

/**
 * Pages éditoriales d'un site : engagements RSE, communiqués, actualités.
 * Titre (`<h1>`, og:title), date (meta, `<time>`, JSON-LD) et texte principal de chaque page.
 */
export class PagesTexte extends HtmlCrawler<JeuArticle> {
  readonly jeu: JeuArticle;
  private readonly options: OptionsPagesTexte;

  constructor(id: string, options: OptionsPagesTexte) {
    super(id);
    this.jeu = options.jeu;
    this.options = options;
    if (options.maxPages) this.maxPages = options.maxPages;
  }

  protected depart() {
    const etiquette = this.options.motifArticle ? 'liste' : 'article';
    return this.options.urls.map((url) => ({ url, etiquette }));
  }

  protected analyser(page: PageHtml): Analyse<JeuArticle> {
    if (page.etiquette === 'liste' && this.options.motifArticle) {
      const motif = versRegExp(this.options.motifArticle);
      const liens = page
        .$('a[href]')
        .map((_, a) => page.$(a).attr('href') ?? '')
        .get()
        .filter((h) => motif.test(h));
      return { suivre: liens.map((url) => ({ url, etiquette: 'article' })) };
    }
    return {
      lignes: [
        lireArticle(
          page,
          this.jeu,
          this.options.marque,
          this.options.selecteurTexte,
        ),
      ],
    };
  }
}

export function lireArticle(
  page: PageHtml,
  jeu: JeuArticle,
  marque: string,
  selecteurTexte?: string,
): LigneArticle {
  const { $ } = page;
  const meta = (nom: string) =>
    $(`meta[property="${nom}"], meta[name="${nom}"]`)
      .first()
      .attr('content')
      ?.trim() ?? '';
  const titre =
    $('h1').first().text().replace(/\s+/g, ' ').trim() ||
    meta('og:title') ||
    $('title').text().trim();
  const date =
    dateIso(meta('article:published_time')) ||
    dateIso($('time[datetime]').first().attr('datetime')) ||
    dateIso(datePublicationJsonLd($)) ||
    dateIso(meta('date'));
  return article(jeu, {
    marque,
    titre,
    date,
    url: page.url,
    texte: textePrincipal($, selecteurTexte),
  });
}

// ---------------------------------------------------------------- GDELT (actus, RSE, matières premières)

export type JeuGdelt = 'actus' | 'rse' | 'matieres_premieres';

/** Une recherche GDELT et les colonnes qu'elle fixe (`{ marque }` ou `{ matiere }`). */
export interface RequeteGdelt<J extends JeuGdelt> {
  q: string;
  valeurs: LigneBrute<J>;
  /**
   * Ne garder que les articles dont le titre (sans accents) correspond. GDELT cherche dans tout le texte,
   * traductions automatiques comprises : sans ce filtre, beaucoup d'articles hors sujet passent.
   */
  titre?: RegExp;
}

export interface OptionsGdelt<J extends JeuGdelt> extends OptionsLecture<J> {
  jeu: J;
  requetes: RequeteGdelt<J>[];
  /** Fenêtre de recherche : `1w`, `1m`, `3m` (le maximum de l'API DOC). */
  periode?: string;
  /** Langues des médias (`sourcelang:`), par défaut français et anglais. */
  langues?: string[];
  /** Articles par requête, 250 au plus. */
  max?: number;
}

interface ArticleGdelt {
  url: string;
  title: string;
  seendate?: string;
  domain?: string;
  language?: string;
}

const GDELT = 'api.gdeltproject.org';

/**
 * L'API DOC de GDELT : la presse mondiale indexée en continu, interrogeable sans clé.
 * Syntaxe : `"phrase exacte"`, `(a OR b)`, `sourcelang:french`, `domain:lemonde.fr`.
 * Doc : https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ — une requête toutes les 5 s.
 */
export class GdeltArticles<J extends JeuGdelt> extends ApiCrawler<
  J,
  number,
  RequeteGdelt<J>
> {
  readonly jeu: J;
  private readonly options: OptionsGdelt<J>;

  constructor(id: string, options: OptionsGdelt<J>) {
    super(id);
    this.jeu = options.jeu;
    this.options = options;
  }

  protected override async demarrer(ctx: Contexte): Promise<void> {
    // L'API annonce « une requête toutes les 5 s » mais répond 429 bien au-delà (mesuré : moins
    // de 45 s entre deux requêtes). Réponses en 10 à 30 s. D'où 45 s de pause et des reprises patientes.
    ctx.http.reglerHote(GDELT, {
      delaiMs: 45_000,
      timeoutMs: 90_000,
      tentatives: 4,
    });
  }

  protected override entrees(): RequeteGdelt<J>[] {
    return this.options.requetes;
  }

  protected premiere(): number {
    return 1;
  }

  protected requete(_page: number, entree: RequeteGdelt<J>): string {
    const langues = (this.options.langues ?? ['french', 'english']).map(
      (l) => `sourcelang:${l}`,
    );
    const filtreLangue =
      langues.length > 1 ? `(${langues.join(' OR ')})` : (langues[0] ?? '');
    const params = new URLSearchParams({
      query: `${entree.q} ${filtreLangue}`.trim(),
      mode: 'artlist',
      format: 'json',
      // Pertinence et fraîcheur mêlées : les articles qui parlent vraiment du sujet d'abord.
      sort: 'hybridrel',
      maxrecords: String(this.options.max ?? 75),
      timespan: this.options.periode ?? '3m',
    });
    return `https://${GDELT}/api/v2/doc/doc?${params}`;
  }

  protected analyser(
    json: unknown,
    _page: number,
    { entree }: { entree: RequeteGdelt<J> },
  ) {
    const articles = (json as { articles?: ArticleGdelt[] }).articles ?? [];
    const lignes = articles
      .filter((a) => !entree.titre || entree.titre.test(sansAccent(a.title)))
      .map((a) => {
        const titre = a.title.trim();
        const commun = {
          titre,
          date: dateIso(a.seendate),
          url: a.url,
          media: a.domain ?? '',
          langue: (a.language ?? '').toLowerCase(),
        };
        const classe =
          this.jeu === 'matieres_premieres'
            ? { signal: signalMatiere(titre) }
            : { type_actu: typeActu(titre) };
        return { ...entree.valeurs, ...commun, ...classe } as LigneBrute<J>;
      });
    return { lignes, suivante: null };
  }

  protected override completer(ligne: LigneBrute<J>, ctx: Contexte) {
    return lireEtFiltrer(this.jeu, ligne, this.options, ctx);
  }
}

/** Ce qu'une source de presse peut faire de chaque article trouvé. */
export interface OptionsLecture<J extends JeuGdelt> {
  /** Aller lire le début de chaque article pour remplir `texte` (une requête de plus par article). */
  lireArticles?: boolean;
  maxCaracteres?: number;
  /** Écarter les articles hors sujet une fois lus (ex. sans signal de prix ni de pénurie). */
  garderSi?: (ligne: LigneBrute<J> & ArticlePresse) => boolean;
}

type ArticlePresse = {
  titre?: string;
  url?: string;
  texte?: string;
  signal?: string;
  type_actu?: string;
};

/** Lit le début de l'article (si demandé), précise le classement, puis garde ou écarte la ligne. */
export async function lireEtFiltrer<J extends JeuGdelt>(
  jeu: J,
  ligne: LigneBrute<J>,
  options: OptionsLecture<J>,
  ctx: Contexte,
): Promise<LigneBrute<J> | undefined> {
  const complete = { ...ligne } as LigneBrute<J> & ArticlePresse;
  if (options.lireArticles && complete.url) {
    try {
      const $ = cheerio.load((await ctx.http.texte(complete.url)).texte);
      complete.texte = tronquer(
        textePrincipal($),
        options.maxCaracteres ?? 1500,
      );
      // Le texte précise souvent le classement que le titre seul ne donnait pas.
      if (jeu === 'matieres_premieres')
        complete.signal ||= signalMatiere(complete.texte);
      else complete.type_actu ||= typeActu(complete.texte);
    } catch (e) {
      // Paywall, 403, robots.txt : courant sur la presse, on garde l'article sans son texte.
      ctx.journal.info(
        `texte non lu : ${complete.url} (${e instanceof Error ? e.message : e})`,
      );
    }
  }
  return !options.garderSi || options.garderSi(complete) ? complete : undefined;
}
