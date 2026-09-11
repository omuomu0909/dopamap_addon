/**
 * utils/placeId.ts
 * Google Maps の DOM と URL から Place ID を抽出するロジック。
 */

/**
 * 現在の URL パラメーター・パスから Place ID を取得する。
 *
 * Google Maps の URL パターン例:
 *   https://www.google.com/maps/place/.../@lat,lng,...
 *   https://www.google.com/maps/search/?api=1&query=...&query_place_id=ChIJ...
 */
export function extractPlaceIdFromUrl(url: string = location.href): string | null {
  // query_place_id パラメーター
  try {
    const u = new URL(url)
    const qpid = u.searchParams.get('query_place_id')
    if (qpid) return qpid
    const placeid = u.searchParams.get('place_id')
    if (placeid) return placeid
  } catch {
    // URL パース失敗は無視
  }

  // /place/... パス内の ChIJ... パターン
  const chijMatch = url.match(/place\/[^/]+\/(ChIJ[A-Za-z0-9_-]+)/)
  if (chijMatch) return chijMatch[1]

  // 現行 Maps の URL: !1s<CID>! パターン（0x... 形式の CID）
  const cidMatch = url.match(/!1s([^!]+)!/)
  if (cidMatch) return cidMatch[1]

  return null
}

/**
 * DOM の data-place-id 属性から Place ID を取得する。
 * observer.ts でも同様のロジックを使うが、単体でも使えるようにエクスポート。
 */
export function extractPlaceIdFromDOM(root: Element = document.body): string | null {
  return root.querySelector('[data-place-id]')?.getAttribute('data-place-id') ?? null
}
