import { useSyncExternalStore } from 'react';
import { initialLocale, isLocale, type Locale } from '../shared/locale';
import { translate } from '../shared/translate';
import { englishMessages } from '../shared/ui-messages';
import { errorMessageFor } from '../shared/errors';
// 旧名（frame.language）の保存も読む。書くのは新しい名前だけ。
const storageKey = 'kokocheck.language', legacyStorageKey = 'frame.language';
let saved: string | null = null;
try { saved = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey); } catch { /* Storage may be unavailable in private mode. */ }
let language: Locale = initialLocale(saved, navigator.languages?.length ? navigator.languages : [navigator.language]);
const listeners = new Set<() => void>();
document.documentElement.lang = language;
export const getLocale = () => language;
export const t = (key: string, ...values: (string | number)[]) => translate(key, language, ...values);
export function errorMessage(message: string) {
  const known = errorMessageFor(message, language);
  if (known) return known;
  const source = Object.keys(englishMessages).find(key => englishMessages[key] === message) ?? message;
  return t(source);
}
export function setLocale(next: Locale) {
  language = next; document.documentElement.lang = next;
  try { localStorage.setItem(storageKey, next); } catch { /* In-memory selection still works. */ }
  listeners.forEach(fn => fn());
}
window.addEventListener('storage', event => {
  if (event.key === storageKey && isLocale(event.newValue)) {
    language = event.newValue; document.documentElement.lang = language; listeners.forEach(fn => fn());
  }
});
export function useLocale() {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, getLocale);
}
export function LanguageSwitch() {
  const lang = useLocale();
  return <div className="language-switch" role="group" aria-label={t('言語')}>
    <button type="button" aria-label="日本語" aria-pressed={lang === 'ja'} onClick={() => setLocale('ja')}>JP</button>
    <button type="button" aria-label="English" aria-pressed={lang === 'en'} onClick={() => setLocale('en')}>EN</button>
  </div>;
}
