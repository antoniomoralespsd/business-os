/** Client identity swatches. Kept muted so cards stay legible; the iris gradient is reserved for accents. */
export const CLIENT_COLORS: Record<string, string> = {
  ink: '#0a0a0a',
  cyan: '#2fc6d6',
  blue: '#5b6cff',
  violet: '#9b7bff',
  pink: '#ee7fbf',
  coral: '#f0745a',
  amber: '#e2a72e',
  lime: '#8cc63f',
  teal: '#2e9e8a',
  stone: '#a8a29e',
};

export const CLIENT_COLOR_KEYS = Object.keys(CLIENT_COLORS);

export function clientColor(key: string | undefined): string {
  return (key && CLIENT_COLORS[key]) || CLIENT_COLORS.ink!;
}
