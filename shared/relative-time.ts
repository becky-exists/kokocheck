import type { Locale } from './locale.js';

/** `5分前` `昨日` のような相対表示。1 週間を過ぎたら日付に任せる。 */
export function relativeTime(iso: string, lang: Locale, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (days >= 7) return new Date(then).toLocaleDateString(lang, { month: 'short', day: 'numeric' });
  if (lang === 'ja') {
    if (minutes < 1) return 'たった今';
    if (hours < 1) return `${minutes}分前`;
    if (days < 1) return `${hours}時間前`;
    return days === 1 ? '昨日' : `${days}日前`;
  }
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (minutes < 1) return 'just now';
  if (hours < 1) return format.format(-minutes, 'minute');
  if (days < 1) return format.format(-hours, 'hour');
  return format.format(-days, 'day');
}
