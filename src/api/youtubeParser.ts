import type { VideoClip } from '../content/videoPlayer'
import type { ChannelFilter } from '../content/sidePanel'

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
  channelFilter: ChannelFilter = { text: '', mode: 'partial' },
  /** true にすると短い店名の「地域名/カテゴリ AND 条件」をスキップする */
  relaxedMatch = false,
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
      const channelName = extractShortsChannelName(vm)
      allShorts.push({ videoId, title, isShort: true, channelName })
      return
    }

    // ② 旧形式 / 通常動画: videoRenderer
    if (isRecord(value.videoRenderer)) {
      const renderer = value.videoRenderer
      const videoId = typeof renderer.videoId === 'string' ? renderer.videoId : ''
      if (!videoId || seen.has(videoId)) return
      seen.add(videoId)
      const title = extractText(renderer.title) || 'YouTube'
      const channelName = extractText(renderer.ownerText) || extractText(renderer.shortBylineText) || ''
      const isShort = isVerticalThumbnail(renderer) || isShortsEndpoint(renderer)
      if (isShort) {
        allShorts.push({ videoId, title, isShort: true, channelName })
      } else {
        allVideos.push({ videoId, title, isShort: false, channelName })
      }
    }
  })

  // 投稿者フィルタON時は信頼できる投稿者の動画なので店名マッチ条件を緩和する:
  //   - 短い店名の「地域名/カテゴリ AND 条件」をスキップ
  //   - 語幹マッチの最小文字数を 3→2 に下げる
  // relaxedMatch は呼び出し元（listScanner）が地域名なしで呼ぶ場合に渡す
  const hasChannelFilter = channelFilter.text.trim().length > 0
  const relaxed = relaxedMatch || hasChannelFilter

  // 店名でフィルタリング
  const placeShorts = allShorts.filter(v => matchesPlaceName(v.title, placeName, areaName, category, relaxed, hasChannelFilter))
  const placeVideos = allVideos.filter(v => matchesPlaceName(v.title, placeName, areaName, category, relaxed, hasChannelFilter))

  // 投稿者フィルタ
  const matchedShorts = applyChannelFilter(placeShorts, channelFilter)
  const matchedVideos = applyChannelFilter(placeVideos, channelFilter)

  // [DEBUG] 診断ログ（本番では除去）
  console.debug('[mapshort] parseVideosFromHtml', {
    placeName, areaName, category, relaxed,
    channelFilter,
    allShortsCount: allShorts.length,
    allVideosCount: allVideos.length,
    placeShortsCount: placeShorts.length,
    placeVideosCount: placeVideos.length,
    matchedShortsCount: matchedShorts.length,
    matchedVideosCount: matchedVideos.length,
    allChannels: [...allShorts, ...allVideos].map(v => v.channelName).slice(0, 20),
    allTitles: [...allShorts, ...allVideos].map(v => v.title).slice(0, 20),
  })

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
 *   ただし relaxed=true の場合はこの AND 条件をスキップする。
 *
 * 投稿者フィルタON時（channelFilterActive=true）:
 *   語幹マッチの最小文字数を 3→2 に緩和する。
 *   （チャンネル名で絞れているため、短い語幹でも誤ヒットリスクが低い）
 */
function matchesPlaceName(
  title: string,
  placeName: string,
  areaName = '',
  category = '',
  relaxed = false,
  channelFilterActive = false,
): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[\s\u3000\-－―【】「」『』（）()・、。！!？?]/g, '')

  const normTitle = normalize(title)
  const normPlace = normalize(placeName)

  // 店名がタイトルに含まれるか（条件1: 完全一致、条件2: 語幹一致）
  // 投稿者フィルタON時は語幹の最小文字数を 3→2 に緩和する
  const minStemLen = channelFilterActive ? 2 : 3
  const stem = normPlace.replace(/(店|屋|亭|家|館|堂|処|所|庵|楼|荘|苑|園)$/, '')
  const nameMatch =
    normTitle.includes(normPlace) ||
    (stem.length >= minStemLen && stem !== normPlace && normTitle.includes(stem))

  // 投稿者フィルタON時: 店名をスペース区切りトークンに分解して各トークンでもマッチを試みる
  // 例: "豚麺 アジト" → ["豚麺", "アジト"] のいずれかがタイトルに含まれればOK
  // ただし2文字以上のトークンのみ対象（1文字は誤ヒットが多すぎる）
  const tokenMatch = channelFilterActive && !nameMatch &&
    placeName.split(/[\s\u3000]+/).some(token => {
      const normToken = normalize(token)
      if (normToken.length < 2) return false
      const tokenStem = normToken.replace(/(店|屋|亭|家|館|堂|処|所|庵|楼|荘|苑|園)$/, '')
      return normTitle.includes(normToken) ||
        (tokenStem.length >= minStemLen && tokenStem !== normToken && normTitle.includes(tokenStem))
    })

  if (!nameMatch && !tokenMatch) return false

  // 店名が短い（4文字以下）場合は地域名 or カテゴリとのAND条件を追加
  // 「自由気まま」「さくら」など一般語で誤ヒットを防ぐ
  // relaxed=true（投稿者フィルタON or listScanner 呼び出し）の場合はスキップ
  if (!relaxed && normPlace.length <= 4) {
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

function extractShortsChannelName(vm: Record<string, unknown>): string {
  // shortsLockupViewModel の accessibilityText は "タイトル, チャンネル名, ..." の形式
  if (typeof vm.accessibilityText === 'string') {
    const parts = vm.accessibilityText.split(',')
    return parts.length >= 2 ? parts[parts.length - 1].trim() : ''
  }
  return ''
}

function applyChannelFilter(clips: VideoClip[], filter: ChannelFilter): VideoClip[] {
  if (!filter.text.trim()) return clips
  const needle = filter.text.trim().toLowerCase()
  return clips.filter(v => {
    const ch = (v.channelName ?? '').toLowerCase()
    return filter.mode === 'exact' ? ch === needle : ch.includes(needle)
  })
}

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
