// 環境変数は KOKOCHECK_<名前> を読み、無ければ旧名 FR_<名前> を読む（旧名のまま動いている起動設定を壊さないため）。
export const env = (name: string, source: NodeJS.ProcessEnv = process.env) => source[`KOKOCHECK_${name}`] || source[`FR_${name}`] || undefined;
/** 制作エージェントに渡す環境から、管理キーを新旧どちらの名前でも外す。 */
export function withoutAdminToken(source: NodeJS.ProcessEnv = process.env) {
  const copy = { ...source };
  delete copy.KOKOCHECK_ADMIN_TOKEN; delete copy.FR_ADMIN_TOKEN;
  return copy;
}
