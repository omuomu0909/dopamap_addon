/** YouTube検索ページのytInitialDataから動画IDを抽出する（Data API不使用）。 */
import { getCache, setCache } from './cache'
import type { SearchResult } from './youtubeParser'
import { parseVideosFromHtml } from './youtubeParser'

const inFlight = new Map<string, Promise<SearchResult>>()
let lastRequestAt = 0
let queue: Promise<void> = Promise.resolve()

/**
 * 店名と地域名で YouTube を検索し、Shorts と通常動画を分類して返す。
 * @param placeName  店名（マッチング判定にも使用）
 * @param areaName   地域名（市区町など。クエリに付加するだけ）
 * @param cacheKey   キャッシュキー（placeId または店名）
 */
export async function searchVideos(
  placeName: string,
  areaName: string,
  cacheKey: string,
  maxResults = 10,
  category = '',
): Promise<SearchResult> {
  const key = `${cacheKey}:v7`
  const cached = getCache<SearchResult>('youtube', key)
  if (cached) return cached

  const inFlightKey = JSON.stringify([placeName, areaName, key, maxResults, category])
  const existing = inFlight.get(inFlightKey)
  if (existing) return existing

  const request = fetchVideos(placeName, areaName, key, maxResults, category)
  inFlight.set(inFlightKey, request)
  request.finally(() => inFlight.delete(inFlightKey)).catch(() => undefined)
  return request
}

async function fetchVideos(
  placeName: string,
  areaName: string,
  cacheKey: string,
  maxResults: number,
  category: string,
): Promise<SearchResult> {
  await enqueue()
  // クエリ: 「地域名 店名 カテゴリ」の順で組み立てる
  const parts = [areaName, placeName, category].filter(Boolean)
  const query = parts.join(' ')
  const html = await fetchSearchPage(query)
  const result = parseVideosFromHtml(html, placeName, maxResults, areaName, category)
  // どちらかに1件以上あればキャッシュ
  if (result.shorts.length > 0 || result.videos.length > 0) {
    setCache('youtube', cacheKey, result)
  }
  return result
}

function fetchSearchPage(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'FETCH_YOUTUBE_SEARCH', query },
      (response: { ok?: boolean; html?: string; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`YouTube検索ページの取得に失敗しました: ${chrome.runtime.lastError.message}`))
          return
        }
        if (!response?.ok || typeof response.html !== 'string') {
          reject(new Error(response?.error ?? 'YouTube検索ページを取得できませんでした'))
          return
        }
        resolve(response.html)
      },
    )
  })
}

function enqueue(): Promise<void> {
  const request = queue.then(async () => {
    const delay = Math.max(0, 500 - (Date.now() - lastRequestAt))
    if (delay) await wait(delay)
    lastRequestAt = Date.now()
  })
  queue = request.catch(() => undefined)
  return request
}

function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }
