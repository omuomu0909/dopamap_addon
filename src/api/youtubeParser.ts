import type { VideoClip } from '../content/videoPlayer'

export interface SearchResult {
  shorts: VideoClip[]   // 縦長 Shorts（店名マッチあり）
  videos: VideoClip[]   // 横長通常動画（店名マッチあり）
  shortsTotal: number   // 店名マッチした Shorts の件数
  videosTotal: number   // 店名マッチした通常動画の件数
}

/**
 * YouTube 検索結果 HTML から VideoClip を抽出し、
 * 店名でフィルタリングしたうえで Shorts / 通常動画に分類する。
 */
export function parseVideosFromHtml(
  html: string,
  placeName: string,
  maxResults = 10,
  areaName = '',
  category = '',
): SearchResult {
  const data = extractInitialData(html)
  if (!data) return { shorts: [], videos: [], shortsTotal: 0, videosTotal: 0 }

  const seen = new Set<string>()
  const allShorts: VideoClip[] = []
  const allVideos: VideoClip[] = []

  walk(data, (value) => {
    if (!isRecord(value)) return

    // ① 現行形式: shortsLockupViewModel（2024年以降 = 必ず縦長 Shorts）
    if (isRecord(value.shortsLockupViewModel)) {
      const vm = value.shortsLockupViewModel
      const videoId = extractShortsVideoId(vm)
      if (!videoId || seen.has(videoId)) return
      seen.add(videoId)
      const title = typeof vm.accessibilityText === 'string'
        ? vm.accessibilityText.split(',')[0].trim()
        : 'YouTube Shorts'
      allShorts.push({ videoId, title, isShort: true })
      return
    }

    // ② 旧形式 / 通常動画: videoRenderer
    if (isRecord(value.videoRenderer)) {
      const renderer = value.videoRenderer
      const videoId = typeof renderer.videoId === 'string' ? renderer.videoId : ''
      if (!videoId || seen.has(videoId)) return
      seen.add(videoId)
      const title = extractText(renderer.title) || 'YouTube'
      const isShort = isVerticalThumbnail(renderer) || isShortsEndpoint(renderer)
      if (isShort) {
        allShorts.push({ videoId, title, isShort: true })
      } else {
        allVideos.push({ videoId, title, isShort: false })
      }
    }
  })

  // 店名でフィルタリング
  const matchedShorts = allShorts.filter(v => matchesPlaceName(v.title, placeName, areaName, category))
  const matchedVideos = allVideos.filter(v => matchesPlaceName(v.title, placeName, areaName, category))

  return {
    shorts: matchedShorts.slice(0, maxResults),
    videos: matchedVideos.slice(0, maxResults),
    shortsTotal: matchedShorts.length,
    videosTotal: matchedVideos.length,
  }
}

/**
 * 動画タイトルに店名が含まれるか判定する。
 *
 * マッチ条件:
 *   1. タイトルに店名がそのまま含まれる
 *   2. 末尾の業態語（店・屋・亭など）を除いた語幹が含まれる
 *
 * 曖昧語対策:
 *   店名が短い（正規化後 4文字以下）か一般的なフレーズの場合、
 *   タイトルに 地域名 OR カテゴリ のどちらかも含まれることを追加要求する。
 */
function matchesPlaceName(title: string, placeName: string, areaName = '', category = ''): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[\s\u3000\-－―【】「」『』（）()・、。！!？?]/g, '')

  const normTitle = normalize(title)
  const normPlace = normalize(placeName)

  // 店名がタイトルに含まれるか（条件1: 完全一致、条件2: 語幹一致）
  const stem = normPlace.replace(/(店|屋|亭|家|館|堂|処|所|庵|楼|荘|苑|園)$/, '')
  const nameMatch =
    normTitle.includes(normPlace) ||
    (stem.length >= 3 && stem !== normPlace && normTitle.includes(stem))

  if (!nameMatch) return false

  // 店名が短い（4文字以下）場合は地域名 or カテゴリとのAND条件を追加
  // 「自由気まま」「さくら」など一般語で誤ヒットを防ぐ
  if (normPlace.length <= 4) {
    const normArea = normalize(areaName)
    const normCat = normalize(category)
    const hasContext =
      (normArea.length > 0 && normTitle.includes(normArea)) ||
      (normCat.length > 0 && normTitle.includes(normCat))
    if (!hasContext) return false
  }

  return true
}

// ─────────────────────────────────────────────
// 内部ユーティリティ
// ─────────────────────────────────────────────

function extractShortsVideoId(vm: Record<string, unknown>): string | null {
  const onTap = isRecord(vm.onTap) ? vm.onTap : null
  const cmd = onTap && isRecord(onTap.innertubeCommand) ? onTap.innertubeCommand : null
  const reel = cmd && isRecord(cmd.reelWatchEndpoint) ? cmd.reelWatchEndpoint : null
  return reel && typeof reel.videoId === 'string' ? reel.videoId : null
}

function isShortsEndpoint(renderer: Record<string, unknown>): boolean {
  const endpoint = isRecord(renderer.navigationEndpoint) ? renderer.navigationEndpoint : null
  const metadata = endpoint && isRecord(endpoint.commandMetadata) ? endpoint.commandMetadata : null
  const web = metadata && isRecord(metadata.webCommandMetadata) ? metadata.webCommandMetadata : null
  return typeof web?.url === 'string' && web.url.includes('/shorts/')
}

function extractInitialData(html: string): unknown | null {
  for (const marker of ['var ytInitialData = ', 'ytInitialData = ']) {
    const start = html.indexOf(marker)
    const jsonStart = start < 0 ? -1 : html.indexOf('{', start + marker.length)
    if (jsonStart < 0) continue
    const json = readObject(html, jsonStart)
    if (json) { try { return JSON.parse(json) as unknown } catch { /* try next */ } }
  }
  return null
}

function readObject(text: string, start: number): string | null {
  let depth = 0; let quoted = false; let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue }
    if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

function isVerticalThumbnail(renderer: Record<string, unknown>): boolean {
  const thumbnails = isRecord(renderer.thumbnail) ? renderer.thumbnail.thumbnails : null
  if (!Array.isArray(thumbnails)) return false
  return thumbnails.some((thumbnail) => {
    if (!isRecord(thumbnail)) return false
    const width = Number(thumbnail.width); const height = Number(thumbnail.height)
    return width > 0 && height >= width * 1.25
  })
}

function walk(value: unknown, visit: (value: unknown) => void): void {
  visit(value)
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit))
  else if (isRecord(value)) Object.values(value).forEach((item) => walk(item, visit))
}

function extractText(value: unknown): string {
  if (!isRecord(value)) return ''
  if (typeof value.simpleText === 'string') return value.simpleText
  if (Array.isArray(value.runs)) return value.runs.map(extractText).join('')
  return typeof value.text === 'string' ? value.text : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
