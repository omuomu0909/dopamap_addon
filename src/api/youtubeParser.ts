import type { VideoClip } from '../content/videoPlayer'

export function parseShortsFromHtml(html: string, maxResults = 10): VideoClip[] {
  const data = extractInitialData(html)
  if (!data) return []

  const seen = new Set<string>()
  const clips: VideoClip[] = []

  walk(data, (value) => {
    if (!isRecord(value)) return

    // 現行形式: shortsLockupViewModel（2024年以降の検索結果）
    if (isRecord(value.shortsLockupViewModel)) {
      const vm = value.shortsLockupViewModel
      const videoId = extractShortsVideoId(vm)
      if (videoId && !seen.has(videoId)) {
        seen.add(videoId)
        const title = typeof vm.accessibilityText === 'string'
          ? vm.accessibilityText.split(',')[0].trim()
          : 'YouTube Shorts'
        clips.push({ videoId, title })
      }
      return
    }

    // 旧形式: videoRenderer（フォールバック）
    if (isRecord(value.videoRenderer)) {
      const renderer = value.videoRenderer
      const videoId = typeof renderer.videoId === 'string' ? renderer.videoId : ''
      if (!videoId || seen.has(videoId)) return
      if (!isVerticalThumbnail(renderer) && !isShortsEndpoint(renderer)) return
      seen.add(videoId)
      clips.push({ videoId, title: extractText(renderer.title) || 'YouTube Shorts' })
    }
  })

  return clips.slice(0, maxResults)
}

/**
 * shortsLockupViewModel から videoId を取得する。
 * パス: onTap.innertubeCommand.reelWatchEndpoint.videoId
 */
function extractShortsVideoId(vm: Record<string, unknown>): string | null {
  const onTap = isRecord(vm.onTap) ? vm.onTap : null
  const cmd = onTap && isRecord(onTap.innertubeCommand) ? onTap.innertubeCommand : null
  const reel = cmd && isRecord(cmd.reelWatchEndpoint) ? cmd.reelWatchEndpoint : null
  const videoId = reel && typeof reel.videoId === 'string' ? reel.videoId : null
  return videoId
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
    if (json) { try { return JSON.parse(json) as unknown } catch { /* try next marker */ } }
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