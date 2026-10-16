export type Locale = 'en' | 'ja';
export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'ja';
// Prefer an explicit selection, then the browser preference. Unsupported languages fall back to English.
export function initialLocale(saved: unknown, languages: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  return negotiateLocale(languages.join(','));
}
export function negotiateLocale(header: string | undefined): Locale {
  const preferences = (header ?? '').split(',').map((part, order) => {
    const [tag, ...params] = part.trim().toLowerCase().split(';');
    const quality = params.find(p => p.trim().startsWith('q='));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    return { tag, q, order };
  }).filter(p => Number.isFinite(p.q) && p.q > 0 && p.q <= 1).sort((a,b) => b.q-a.q || a.order-b.order);
  for (const {tag} of preferences) {
    const language = tag.split('-')[0];
    if (isLocale(language)) return language;
    if (tag === '*') return 'en';
  }
  return 'en';
}
