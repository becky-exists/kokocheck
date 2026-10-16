import { englishMessages, englishSingular } from './ui-messages.js';
import type { Locale } from './locale.js';
export function translate(key: string, lang: Locale, ...values: (string | number)[]): string {
  const trimmed = key.trim();
  const singular = englishSingular[trimmed];
  const translated = lang === 'en' ? (singular && Number(values[singular.index]) === 1 ? singular.text : englishMessages[trimmed]) : undefined;
  const template = translated === undefined ? key : key.slice(0,key.indexOf(trimmed)) + translated + key.slice(key.indexOf(trimmed)+trimmed.length);
  // Substitute only the template, never interpret placeholders in user-authored values.
  return template.replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match));
}
