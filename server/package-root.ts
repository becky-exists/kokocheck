import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** package.json のあるフォルダを、呼び出し元ファイルから上に辿って探す。tsx で repo から動かす時も、build/ 配下のコンパイル済みを動かす時も同じ場所を指す。 */
export function packageRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  while (!existsSync(resolve(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('package.json not found above ' + fileURLToPath(fromUrl));
    dir = parent;
  }
  return dir;
}
