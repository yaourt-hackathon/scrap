import { ErreurRobots, type ClientHttp } from './http.ts';
import { JEUX, type Jeu, type Ligne, type LigneBrute } from './jeux.ts';

/** Ce qu'un crawler reçoit pour travailler. Rien de global : tout passe par là. */
export interface Contexte {
  http: ClientHttp;
  journal: Journal;
  /** Arrête le crawler après N lignes gardées (pour essayer une source). */
  limite?: number;
  /** Date du jour (AAAA-MM-JJ), écrite dans `date_scrap`. */
  aujourdhui: string;
}

export interface Bilan<J extends Jeu> {
  id: string;
  jeu: J;
  lignes: Ligne<J>[];
  ecartees: number;
  doublons: number;
  erreurs: number;
  bloquees: number;
  duree: number;
}

/** Journal préfixé par l'identifiant de la source, qui compte les erreurs. */
export class Journal {
  erreurs = 0;
  bloquees = 0;
  private readonly prefixe: string;

  constructor(prefixe: string) {
    this.prefixe = prefixe;
  }

  info(message: string): void {
    console.log(`[${this.prefixe}] ${message}`);
  }

  /** Une page ou une requête a échoué : on la note et on continue. */
  erreur(message: string, e?: unknown): void {
    if (e instanceof ErreurRobots) {
      this.bloquees++;
      console.warn(`[${this.prefixe}] ignoré : ${e.message}`);
      return;
    }
    this.erreurs++;
    const detail =
      e instanceof Error ? ` (${e.message})` : e ? ` (${String(e)})` : '';
    console.warn(`[${this.prefixe}] ERREUR ${message}${detail}`);
  }
}

/**
 * La racine de tous les crawlers, à la manière de `BaseCrawlerRunner` dans Malacrawl.
 *
 * Une classe dérivée n'écrit que `extraire()` : un générateur qui produit des lignes au fil de l'eau.
 * La base s'occupe du reste : `completer()` ligne par ligne (le passage liste → fiche détail),
 * nettoyage des espaces, colonnes obligatoires, doublons, limite, date et source, bilan.
 *
 * Dérivations prêtes à l'emploi : HtmlCrawler, PlaywrightCrawler, ApiCrawler, RssCrawler (`src/crawlers/`).
 */
export abstract class Crawler<J extends Jeu> {
  readonly id: string;
  abstract readonly jeu: J;

  constructor(id: string) {
    this.id = id;
  }

  /** Produit les lignes une à une. Une erreur sur une page doit être journalisée ici, pas levée. */
  protected abstract extraire(ctx: Contexte): AsyncIterable<LigneBrute<J>>;

  /**
   * Enrichit une ligne (ex. aller chercher les ingrédients sur la fiche produit). Par défaut : rien.
   * Rendre `undefined` écarte la ligne (ce qu'on vient de lire montre qu'elle est hors sujet).
   */
  protected async completer(
    ligne: LigneBrute<J>,
    ctx: Contexte,
  ): Promise<LigneBrute<J> | undefined> {
    void ctx;
    return ligne;
  }

  /** Avant le premier `extraire()` (ouvrir un navigateur…). */
  protected async demarrer(ctx: Contexte): Promise<void> {
    void ctx;
  }

  /** Toujours appelé à la fin, même après une erreur (fermer le navigateur…). */
  protected async terminer(ctx: Contexte): Promise<void> {
    void ctx;
  }

  async executer(ctx: Contexte): Promise<Bilan<J>> {
    const debut = Date.now();
    const def = JEUX[this.jeu];
    const vues = new Set<string>();
    const lignes: Ligne<J>[] = [];
    let ecartees = 0;
    let doublons = 0;

    try {
      await this.demarrer(ctx);
      for await (const brute of this.extraire(ctx)) {
        let complete: LigneBrute<J> | undefined = brute;
        try {
          complete = await this.completer(brute, ctx);
        } catch (e) {
          ctx.journal.erreur(
            `complément de ${String(brute['url' as keyof typeof brute])}`,
            e,
          );
        }
        if (!complete) {
          ecartees++;
          continue;
        }
        const ligne = nettoyer({
          ...complete,
          date_scrap: ctx.aujourdhui,
          source: this.id,
        });

        const manque = def.obligatoires.filter(
          (c) => !ligne[c as keyof typeof ligne],
        );
        if (manque.length) {
          ecartees++;
          continue;
        }
        const cle = def.cle
          .map((c) => ligne[c as keyof typeof ligne])
          .join('\u0000');
        if (vues.has(cle)) {
          doublons++;
          continue;
        }
        vues.add(cle);
        lignes.push(ligne as Ligne<J>);
        if (ctx.limite && lignes.length >= ctx.limite) break;
      }
    } catch (e) {
      // Erreur qui arrête la source (site injoignable…) : on garde ce qui a déjà été lu.
      ctx.journal.erreur('arrêt de la source', e);
    } finally {
      await this.terminer(ctx);
    }

    return {
      id: this.id,
      jeu: this.jeu,
      lignes,
      ecartees,
      doublons,
      erreurs: ctx.journal.erreurs,
      bloquees: ctx.journal.bloquees,
      duree: Date.now() - debut,
    };
  }
}

/**
 * Espaces normalisés partout. Seul `texte` garde ses sauts de ligne (paragraphes),
 * utiles au LLM qui lira le texte ; les autres colonnes tiennent sur une ligne.
 */
function nettoyer(
  ligne: Record<string, string | undefined>,
): Record<string, string> {
  const propre: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(ligne)) {
    if (valeur === undefined || valeur === null) continue;
    const v = String(valeur).replaceAll('\u00a0', ' ');
    propre[cle] =
      cle === 'texte'
        ? v
            .split(/\r?\n/)
            .map((l) => l.replace(/[ \t]+/g, ' ').trim())
            .filter(Boolean)
            .join('\n')
        : v.replace(/\s+/g, ' ').trim();
  }
  return propre;
}
