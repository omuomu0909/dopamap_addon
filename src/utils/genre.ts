/**
 * utils/genre.ts
 * 場所名・エリア名から YouTube 検索クエリを生成する。
 * 現行 WebApp の src/utils/genre.ts から移植。
 */

/** YouTube Shorts 検索クエリを生成する */
export function buildYouTubeQuery(placeName: string, areaName?: string): string {
  const base = areaName ? `${placeName} ${areaName}` : placeName
  return `${base} グルメ ショート shorts`
}

/** Place ID がない場合のフォールバッククエリ */
export function buildFallbackQuery(placeName: string): string {
  return `${placeName} グルメ ショート shorts`
}
