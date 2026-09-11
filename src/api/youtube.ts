/** YouTube検索ページのytInitialDataから動画IDを抽出する（Data API不使用）。 */
import { getCache, setCache } from './cache'
import type { SearchResult } from './youtubeParser'
import { parseVideosFromHtml } from './youtubeParser'
import type { ChannelFilter } from '../content/sidePanel'

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
  extraKeyword = '',
  channelFilter: ChannelFilter = { text: '', mode: 'partial' },
  relaxedMatch = false,
): Promise<SearchResult> {
  const key = `${cacheKey}:v7:${extraKeyword}:ch:${channelFilter.text}:${channelFilter.mode}${relaxedMatch ? ':relaxed' : ''}`
  const cached = getCache<SearchResult>('youtube', key)
  if (cached) return cached

  const inFlightKey = JSON.stringify([placeName, areaName, key, maxResults, category, extraKeyword, channelFilter, relaxedMatch])
  const existing = inFlight.get(inFlightKey)
  if (existing) return existing

  const request = fetchVideos(placeName, areaName, key, maxResults, category, extraKeyword, channelFilter, relaxedMatch)
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
  extraKeyword: string,
  channelFilter: ChannelFilter,
  relaxedMatch = false,
): Promise<SearchResult> {
  await enqueue()
  // クエリ: 「地域名 店名 カテゴリ 追加キーワード」の順で組み立てる
  const parts = [areaName, placeName, category, extraKeyword, channelFilter.text.trim()].filter(Boolean)
  const query = parts.join(' ')
  console.log('[mapshort] fetchVideos: fetching query=', query)
  const html = await fetchSearchPage(query)
  console.log('[mapshort] fetchVideos: html length=', html.length, 'hasInitialData=', html.includes('ytInitialData'))
  const result = parseVideosFromHtml(html, placeName, maxResults, areaName, category, channelFilter, relaxedMatch)
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
