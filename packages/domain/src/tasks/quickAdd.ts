import type { Client, ID } from '@bos/schemas';

const normalize = (s: string) =>
  s
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export interface QuickAddResult {
  title: string;
  clientId: ID | null;
}

/**
 * "Flyer Halloween City Hall" → { title: "Flyer Halloween", clientId: <City Hall> }
 * Matches the longest client name/alias appearing as whole words. Never guesses on partial words.
 */
export function parseQuickAdd(raw: string, clients: readonly Pick<Client, 'id' | 'name' | 'aliases' | 'status'>[]): QuickAddResult {
  const text = raw.trim().replace(/\s+/g, ' ');
  const haystack = ` ${normalize(text)} `;

  let best: { clientId: ID; needle: string } | null = null;
  for (const c of clients) {
    if (c.status === 'archived') continue;
    for (const name of [c.name, ...c.aliases]) {
      const needle = normalize(name);
      if (needle.length < 2) continue;
      if (haystack.includes(` ${needle} `) && (!best || needle.length > best.needle.length)) {
        best = { clientId: c.id, needle };
      }
    }
  }
  if (!best) return { title: text, clientId: null };

  // Remove the matched words from the original text (accent/case-insensitive), keep the rest as title.
  const words = text.split(' ');
  const needleWords = best.needle.split(' ');
  for (let i = 0; i + needleWords.length <= words.length; i++) {
    const slice = words.slice(i, i + needleWords.length).map(normalize).join(' ');
    if (slice === best.needle) {
      const rest = [...words.slice(0, i), ...words.slice(i + needleWords.length)]
        .join(' ')
        .replace(/\s+[-–—·,]\s*$/u, '')
        .replace(/^\s*[-–—·,]\s+/u, '')
        .trim();
      return { title: rest.length > 0 ? rest : text, clientId: best.clientId };
    }
  }
  return { title: text, clientId: best.clientId };
}
