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
 */
export function extractPlaceIdFromDOM(root: Element = document.body): string | null {
  return root.querySelector('[data-place-id]')?.getAttribute('data-place-id') ?? null
}

/**
 * Google Maps の詳細パネルから業態カテゴリ（例: "居酒屋", "ラーメン店"）を抽出する。
 * Maps の UI では店名(h1) の直下に小テキストで表示される。
 */
export function extractCategory(panelEl: Element): string {
  // button.DkEaL が Maps の業態ボタン（例: "ラーメン屋"、"居酒屋"）
  // SPAN.DkEaL は "ラベルを追加" などUIテキストなので除外
  const catEl = panelEl.querySelector('button.DkEaL') ?? null
  const text = catEl?.textContent?.trim() ?? ''
  if (!text || text.length > 20) return ''
  return text
}

/**
 * Google Maps の詳細パネルから地域名（市区町村）を抽出する。
 * 住所テキスト（例: "〒150-0001 東京都渋谷区神宮前1丁目"）から
 * 都道府県・区・市・町を取り出す。
 */
export function extractAreaName(panelEl: Element): string {
  // 住所っぽいテキストを持つ要素を探す
  const addressEl = panelEl.querySelector('[data-item-id="address"]')
    ?? panelEl.querySelector('button[data-item-id*="address"]')
    ?? Array.from(panelEl.querySelectorAll('button, span, div')).find(
      el => /〒?\d{3}-?\d{4}|東京|大阪|京都|神奈川|北海道/.test(el.textContent ?? ''),
    )
    ?? null

  const text = addressEl?.textContent?.trim() ?? ''

  // 都道府県名だけを返す（「広島」「東京」「大阪」など）
  // 「東京都」→「東京」、「広島県」→「広島」のように末尾の都道府県字を除去
  const m = text.match(/(東京|大阪|京都|北海道|[^\s\d〒ー－−\-]{2,4})[都道府県]/)
  if (m?.[1]) return m[1]

  return ''
}
