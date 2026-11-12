import * as cheerio from 'cheerio';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Contexte } from '../core/crawler.ts';
import type { Jeu } from '../core/jeux.ts';
import { HtmlCrawler, type PageHtml, type Visite } from './html.ts';

/**
 * HtmlCrawler dont les pages sont rendues par Chromium : pour les sites qui construisent
 * leur contenu en JavaScript. Même `depart()` et `analyser()` que HtmlCrawler, qui reçoit le HTML rendu.
 * Pour cliquer, faire défiler ou accepter les cookies avant la lecture : `preparer(page)`.
 *
 * - `SCRAP_CDP_URL` (variable d'environnement) : se connecter à un navigateur distant en CDP
 *   (BrightData, Krowler, un Chrome lancé avec --remote-debugging-port) au lieu d'en lancer un.
 * - Images, polices et vidéos sont bloquées (comme `setupBandwidthOptimization` dans Malacrawl).
 * - Navigateur à installer une fois : `npm run navigateur:installer`.
 */
export abstract class PlaywrightCrawler<J extends Jeu> extends HtmlCrawler<J> {
  /** Sélecteur à attendre avant de lire la page (ex. le bloc ingrédients). */
  protected attendreSelecteur?: string;
  protected delaiRenduMs = 30_000;
  protected bloquer = ['image', 'font', 'media'];

  private navigateur?: Browser;
  private contexte?: BrowserContext;

  /** Après le chargement, avant la lecture : cliquer sur « Ingrédients », accepter les cookies… */
  protected async preparer(
    page: Page,
    visite: Visite,
    ctx: Contexte,
  ): Promise<void> {
    void page;
    void visite;
    void ctx;
  }

  protected override async demarrer(ctx: Contexte): Promise<void> {
    const { chromium } = await import('playwright');
    const cdp = process.env.SCRAP_CDP_URL;
    this.navigateur = cdp
      ? await chromium.connectOverCDP(cdp, { timeout: 60_000 })
      : await chromium.launch({ headless: true });
    this.contexte = await this.navigateur.newContext({
      userAgent: ctx.http.userAgent,
      locale: 'fr-FR',
    });
    await this.contexte.route('**/*', (route) =>
      this.bloquer.includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    ctx.journal.info(
      cdp ? 'navigateur distant (CDP)' : 'navigateur Chromium lancé',
    );
  }

  protected override async terminer(): Promise<void> {
    await this.contexte?.close().catch(() => undefined);
    await this.navigateur?.close().catch(() => undefined);
    this.contexte = undefined;
    this.navigateur = undefined;
  }

  protected override async charger(
    visite: Visite,
    ctx: Contexte,
  ): Promise<PageHtml> {
    if (!this.contexte) throw new Error('navigateur non démarré');
    await ctx.http.verifierRobots(visite.url);
    await ctx.http.patienter(visite.url);
    const page = await this.contexte.newPage();
    try {
      await page.goto(visite.url, {
        waitUntil: 'domcontentloaded',
        timeout: this.delaiRenduMs,
      });
      if (this.attendreSelecteur) {
        await page
          .waitForSelector(this.attendreSelecteur, {
            timeout: this.delaiRenduMs,
          })
          .catch(() =>
            ctx.journal.info(
              `${this.attendreSelecteur} absent sur ${visite.url}`,
            ),
          );
      } else {
        await page
          .waitForLoadState('networkidle', { timeout: 10_000 })
          .catch(() => undefined);
      }
      await this.preparer(page, visite, ctx);
      const html = await page.content();
      return {
        url: page.url(),
        etiquette: visite.etiquette ?? '',
        html,
        $: cheerio.load(html),
      };
    } finally {
      // Le HTML rendu est lu : on ferme l'onglet pour ne pas les accumuler.
      await page.close().catch(() => undefined);
    }
  }
}
