import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Une cellule CSV (RFC 4180) : entre guillemets dès qu'elle contient une virgule, un guillemet ou un saut de ligne. */
export function cellule(valeur: string | undefined): string {
  const v = valeur ?? '';
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

/** Le texte d'un CSV : en-tête puis une ligne par enregistrement, fins de ligne Unix. */
export function versCsv(
  colonnes: readonly string[],
  lignes: ReadonlyArray<Partial<Record<string, string>>>,
): string {
  const corps = lignes.map((l) => colonnes.map((c) => cellule(l[c])).join(','));
  return [colonnes.join(','), ...corps].join('\n') + '\n';
}

/** Écrit le CSV en UTF-8 sans jamais laisser un fichier à moitié écrit (fichier temporaire puis renommage). */
export async function ecrireCsv(
  chemin: string,
  colonnes: readonly string[],
  lignes: ReadonlyArray<Partial<Record<string, string>>>,
): Promise<void> {
  await mkdir(dirname(chemin), { recursive: true });
  const temporaire = `${chemin}.${process.pid}.tmp`;
  await writeFile(temporaire, versCsv(colonnes, lignes), 'utf-8');
  await rename(temporaire, chemin);
}
