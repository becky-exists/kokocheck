import { t, getLocale } from './i18n';
import { clsx, type ClassValue } from 'clsx';
import { isBlankFrame } from '../shared/frame';
import { twMerge } from 'tailwind-merge';
export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
export const reviewKey = () => new URLSearchParams(location.hash.slice(1)).get('key') || '';
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept-Language', getLocale());
  if (reviewKey()) headers.set('X-Review-Token', reviewKey());
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.code || data.error || t("処理に失敗しました。"));
  return data as T;
}
export const post = <T,>(path: string, data: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export function mediaUrl(projectId: string, file: string, key = reviewKey()) {
  return `/api/projects/${projectId}/media/${file}${key ? `?key=${encodeURIComponent(key)}` : ''}`;
}
export function containRect(container: { width: number; height: number }, width: number, height: number) {
  const scale = Math.min(container.width / width, container.height / height);
  return { width: width * scale, height: height * scale, left: (container.width - width * scale) / 2, top: (container.height - height * scale) / 2 };
}

function seekTo(video: HTMLVideoElement, time: number) {
  return new Promise<void>(resolve => {
    const done = () => { video.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 1000);
    video.addEventListener('seeked', done); video.currentTime = time;
  });
}
/**
 * いま止まっているコマを JPEG のデータ URL にする。保存も送信もしない、画面の中だけの絵。
 * 読み込み直後の 0:00 は readyState が進んでいても真っ黒に描かれることがあるので、
 * 黒かった時だけ1コマぶん進めて描き、元の位置に戻す。
 */
export async function captureFrame(video: HTMLVideoElement, width = 480): Promise<string> {
  if (video.readyState < 2 || !video.videoWidth) return '';
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = Math.round(width * video.videoHeight / video.videoWidth);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (isBlankFrame(ctx.getImageData(0, 0, canvas.width, canvas.height).data)) {
      const at = video.currentTime;
      await seekTo(video, Math.min(at + 0.04, Math.max(0, video.duration - 0.01)));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      await seekTo(video, at);
    }
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch { return ''; }
}

// 表示名の保存。旧名（frame.author）も読み、書くのは新しい名前（kokocheck.author）だけ。
export const savedAuthor = () => localStorage.getItem('kokocheck.author') || localStorage.getItem('frame.author');
