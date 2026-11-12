import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { lireRobots, type Robots } from './robots.ts';

export const USER_AGENT =
  'YaourtScrap/0.1 (projet etudiant HETIC, hackathon Givaudan)';

export interface OptionsHttp {
  userAgent?: string;
  /** Pause minimale entre deux requêtes vers le même hôte. */
  delaiMs?: number;
  /** Réglages propres à un hôte, qui remplacent ceux par défaut (ex. GDELT : 5 s entre deux requêtes). */
  parHote?: Record<string, ReglagesHote>;
  tentatives?: number;
  timeoutMs?: number;
  respecterRobots?: boolean;
  /** Dossier où garder les réponses : on relance le parsing sans refaire les requêtes. */
  dossierCache?: string;
}

export interface ReglagesHote {
  delaiMs?: number;
  timeoutMs?: number;
  tentatives?: number;
}

export interface Reponse {
  /** URL finale, après redirections. */
  url: string;
  statut: number;
  entetes: Headers;
  texte: string;
}

export class ErreurHttp extends Error {
  readonly statut: number;
  readonly url: string;
  constructor(statut: number, url: string) {
    super(`HTTP ${statut} sur ${url}`);
    this.statut = statut;
    this.url = url;
  }
}

/** La page existe mais le robots.txt du site nous demande de ne pas la lire. */
export class ErreurRobots extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`interdit par robots.txt : ${url}`);
    this.url = url;
  }
}

const REESSAYABLES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Le seul point de sortie vers le réseau. Tous les crawlers passent par lui, et y gagnent :
 * un User-Agent honnête, une pause par hôte, le respect de robots.txt, des reprises avec attente
 * croissante (et `Retry-After`), le décodage gzip et charset, un cache disque optionnel.
 */
export class ClientHttp {
  private readonly options: Required<Omit<OptionsHttp, 'dossierCache'>> & {
    dossierCache?: string;
  };
  private readonly prochainTour = new Map<string, number>();
  private readonly robots = new Map<string, Promise<Robots>>();

  constructor(options: OptionsHttp = {}) {
    this.options = {
      userAgent: USER_AGENT,
      delaiMs: 1500,
      tentatives: 3,
      timeoutMs: 30_000,
      respecterRobots: true,
      ...options,
      parHote: { ...options.parHote },
    };
  }

  get userAgent(): string {
    return this.options.userAgent;
  }

  /** Une API qui demande plus de patience (GDELT : une requête toutes les 5 s, réponses lentes). */
  reglerHote(hote: string, reglages: ReglagesHote): void {
    this.options.parHote[hote] = { ...this.options.parHote[hote], ...reglages };
  }

  private reglages(url: string): Required<ReglagesHote> {
    const propres = this.options.parHote[new URL(url).host];
    return {
      delaiMs: propres?.delaiMs ?? this.options.delaiMs,
      timeoutMs: propres?.timeoutMs ?? this.options.timeoutMs,
      tentatives: propres?.tentatives ?? this.options.tentatives,
    };
  }

  /** GET (ou autre méthode via `init`) et renvoie le texte. Lève ErreurHttp hors 2xx. */
  async texte(url: string, init: RequestInit = {}): Promise<Reponse> {
    const cle = this.cleCache(url, init);
    const enCache = await this.lireCache(cle);
    if (enCache) return enCache;

    await this.verifierRobots(url);
    const reponse = await this.avecReprises(url, init);
    await this.ecrireCache(cle, reponse);
    return reponse;
  }

  async json<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
    const r = await this.texte(url, {
      ...init,
      headers: { accept: 'application/json', ...init.headers },
    });
    return JSON.parse(r.texte) as T;
  }

  /** Pour un crawler qui sort sans passer par `texte()` (navigateur) : même politesse. */
  async patienter(url: string): Promise<void> {
    const hote = new URL(url).host;
    const maintenant = Date.now();
    const tour = Math.max(maintenant, this.prochainTour.get(hote) ?? 0);
    this.prochainTour.set(hote, tour + this.reglages(url).delaiMs);
    if (tour > maintenant) await pause(tour - maintenant);
  }

  /** La pause se compte aussi depuis la fin de la réponse : une API lente n'est pas relancée aussitôt. */
  private finDeTour(url: string): void {
    const hote = new URL(url).host;
    const apres = Date.now() + this.reglages(url).delaiMs;
    this.prochainTour.set(
      hote,
      Math.max(apres, this.prochainTour.get(hote) ?? 0),
    );
  }

  async verifierRobots(url: string): Promise<void> {
    if (!this.options.respecterRobots) return;
    const cible = new URL(url);
    const robots = await this.robotsDe(cible.origin);
    if (!robots.autorise(cible.pathname + cible.search))
      throw new ErreurRobots(url);
  }

  /** Les sitemaps déclarés dans robots.txt (vide si le site n'en a pas). */
  async sitemapsDe(origine: string): Promise<string[]> {
    return (await this.robotsDe(origine)).sitemaps;
  }

  private robotsDe(origine: string): Promise<Robots> {
    let robots = this.robots.get(origine);
    if (!robots) {
      robots = this.avecReprises(`${origine}/robots.txt`, {})
        .then((r) => lireRobots(r.texte, this.options.userAgent))
        // Pas de robots.txt (404) ou illisible : tout est permis.
        .catch(() => lireRobots('', this.options.userAgent));
      this.robots.set(origine, robots);
    }
    return robots;
  }

  private async avecReprises(url: string, init: RequestInit): Promise<Reponse> {
    const { delaiMs, timeoutMs, tentatives } = this.reglages(url);
    let derniere: unknown;
    for (let essai = 1; essai <= tentatives; essai++) {
      await this.patienter(url);
      let attenteAvantReprise = Math.min(delaiMs * 2 ** essai, 120_000);
      try {
        const r = await fetch(url, {
          redirect: 'follow',
          ...init,
          headers: {
            'user-agent': this.options.userAgent,
            'accept-language': 'fr-FR,fr;q=0.9,en;q=0.5',
            ...init.headers,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (r.ok) {
          return {
            url: r.url || url,
            statut: r.status,
            entetes: r.headers,
            texte: await decoder(r),
          };
        }
        derniere = new ErreurHttp(r.status, url);
        if (!REESSAYABLES.has(r.status)) throw derniere;
        attenteAvantReprise =
          retryAfter(r.headers.get('retry-after')) ?? attenteAvantReprise;
      } catch (e) {
        if (e instanceof ErreurHttp && !REESSAYABLES.has(e.statut)) throw e;
        derniere = e;
      } finally {
        this.finDeTour(url);
      }
      if (essai < tentatives) await pause(attenteAvantReprise);
    }
    throw derniere;
  }

  private cleCache(url: string, init: RequestInit): string | undefined {
    if (!this.options.dossierCache) return undefined;
    const corps = typeof init.body === 'string' ? init.body : '';
    return createHash('sha1')
      .update(`${init.method ?? 'GET'} ${url} ${corps}`)
      .digest('hex');
  }

  private async lireCache(
    cle: string | undefined,
  ): Promise<Reponse | undefined> {
    if (!cle || !this.options.dossierCache) return undefined;
    try {
      const brut = JSON.parse(
        await readFile(join(this.options.dossierCache, `${cle}.json`), 'utf-8'),
      );
      return { ...brut, entetes: new Headers(brut.entetes) };
    } catch {
      return undefined;
    }
  }

  private async ecrireCache(
    cle: string | undefined,
    r: Reponse,
  ): Promise<void> {
    if (!cle || !this.options.dossierCache) return;
    await mkdir(this.options.dossierCache, { recursive: true });
    const brut = { ...r, entetes: Object.fromEntries(r.entetes) };
    await writeFile(
      join(this.options.dossierCache, `${cle}.json`),
      JSON.stringify(brut),
      'utf-8',
    );
  }
}

/** Décode le corps : gzip (sitemaps .xml.gz servis tels quels), puis le charset annoncé, UTF-8 sinon. */
async function decoder(r: Response): Promise<string> {
  let octets = new Uint8Array(await r.arrayBuffer());
  if (octets[0] === 0x1f && octets[1] === 0x8b)
    octets = new Uint8Array(gunzipSync(octets));
  const charset =
    /charset=([\w-]+)/i.exec(r.headers.get('content-type') ?? '')?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(charset).decode(octets);
  } catch {
    return new TextDecoder('utf-8').decode(octets);
  }
}

/** `Retry-After` en secondes (plafonné à 2 minutes), ou undefined. */
function retryAfter(entete: string | null): number | undefined {
  const secondes = Number(entete);
  return entete && Number.isFinite(secondes)
    ? Math.min(secondes * 1000, 120_000)
    : undefined;
}

export function pause(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
}
