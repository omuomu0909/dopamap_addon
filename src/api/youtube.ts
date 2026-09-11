/** YouTube検索ページのytInitialDataから動画IDを抽出する（Data API不使用）。 */
import { getCache, setCache } from './cache'
import type { VideoClip } from '../content/videoPlayer'
import { parseShortsFromHtml } from './youtubeParser'

const SEARCH_URL = 'https://www.youtube.com/results?search_query='
const inFlight = new Map<string, Promise<VideoClip[]>>()
let lastRequestAt = 0
let queue: Promise<void> = Promise.resolve()

export async function searchShorts(query: string, cacheKey: string, maxResults = 10): Promise<VideoClip[]> {
  // バージョン番号を上げると既存キャッシュが無効化される
  const shortsCacheKey = `${cacheKey}:shorts-v3`
  const cached = getCache<VideoClip[]>('youtube', shortsCacheKey)
  if (cached) return cached
  const key = JSON.stringify([query, shortsCacheKey, maxResults])
  const existing = inFlight.get(key)
  if (existing) return existing
  const request = fetchShorts(query, shortsCacheKey, maxResults)
  inFlight.set(key, request)
  request.finally(() => inFlight.delete(key)).catch(() => undefined)
  return request
}

async function fetchShorts(query: string, cacheKey: string, maxResults: number): Promise<VideoClip[]> {
  await enqueue()
  const html = await fetchSearchPage(query)
  const result = parseShortsFromHtml(html, maxResults)
  // 空結果はキャッシュしない（一時的な取得失敗でキャッシュが汚染されるのを防ぐ）
  if (result.length > 0) setCache('youtube', cacheKey, result)
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