/** 取り込んだコマが真っ黒か（まだ描かれていない可能性が高い）。RGBA の配列を粗く調べる。 */
export function isBlankFrame(data: ArrayLike<number>): boolean {
  for (let i = 0; i < data.length; i += 16) if (data[i] > 6 || data[i + 1] > 6 || data[i + 2] > 6) return false;
  return true;
}

/**
 * 画面用の、十字なしのコマ画像の名前。AI に渡す十字入りの snapshot はそのまま残し、
 * ピンがあるコメントにだけ並べて作る（mcp の `^[a-f0-9-]+\.jpg$` に収まる名前）。
 */
export const plainSnapshotName = (snapshot: string) => snapshot.replace(/\.jpg$/, '-0.jpg');
