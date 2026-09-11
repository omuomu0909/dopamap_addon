# Chrome拡張版 mapshort — 実装依頼プロンプト

以下をそのまま新しいワークスペースのエージェントに貼り付けて使う。

---

## プロンプト本文

---

設計書に基づいて Chrome 拡張 **mapshort** を実装してください。

### プロジェクト概要

本家 Google Maps (maps.google.com) 上に「▶ ショート動画」ボタンを注入し、  
選択した場所に紐づく YouTube Shorts をマップ上のフローティングプレイヤーで再生する Chrome 拡張です。

詳細設計は添付の `CHROME_EXTENSION_DESIGN.md` を参照してください。  
以下は実装に必要な補足情報です。

---

### 移植元コード（参考実装）

以下のファイルは別リポジトリ（Webアプリ版 mapshort）の実装です。  
Chrome 拡張版でも同じロジックを使うため、参考にして移植してください。

#### `src/api/youtube.ts` — YouTube Data API v3 呼び出し

```typescript
import type { VideoClip } from '../types'
import { buildYouTubeQuery } from '../utils/genre'
import { cacheGet, cacheSet, youtubeKey, TTL } from './cache'

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search'
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos'

type YouTubeSearchItem = {
  id: { videoId: string }
  snippet: {
    title: string
    channelTitle: string
    publishedAt: string
    thumbnails: { medium?: { url: string }; default?: { url: string } }
  }
}
type YouTubeSearchResponse = {
  items?: YouTubeSearchItem[]
  error?: { message: string; code: number }
}
type YouTubeVideoItem = {
  id: string
  statistics: { viewCount?: string; likeCount?: string }
}
type YouTubeVideosResponse = { items?: YouTubeVideoItem[] }

/**
 * 店名とエリア名から YouTube Shorts を最大 maxResults 件取得する
 * 統計情報（再生回数・いいね数）も一緒に取得する
 *
 * 拡張版での変更点:
 *   - API_KEY の取得元を chrome.storage.sync.get('youtubeApiKey') に変える
 *   - それ以外のロジックはそのまま
 */
export async function fetchShortsForRestaurant(
  placeId: string,
  restaurantName: string,
  areaName: string,
  apiKey: string,          // ← 拡張版では引数で受け取る
  maxResults = 3,
): Promise<VideoClip[]> {
  if (!apiKey) return []

  const key = youtubeKey(placeId)
  const cached = cacheGet<VideoClip[]>(key)
  if (cached) return cached

  const query = buildYouTubeQuery(restaurantName, areaName)
  const searchParams = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoDuration: 'short',
    videoEmbeddable: 'true',
    maxResults: String(maxResults),
    order: 'viewCount',
    key: apiKey,
  })

  try {
    const searchRes = await fetch(`${SEARCH_URL}?${searchParams}`)
    if (!searchRes.ok) return []

    const searchJson: YouTubeSearchResponse = await searchRes.json()
    if (searchJson.error || !searchJson.items) return []

    const baseClips = searchJson.items
      .filter((item) => Boolean(item.id.videoId))
      .map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        thumbnail:
          item.snippet.thumbnails.medium?.url ??
          item.snippet.thumbnails.default?.url ??
          `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
        viewCount: null as number | null,
        likeCount: null as number | null,
      }))

    if (baseClips.length === 0) return []

    const ids = baseClips.map((c) => c.videoId).join(',')
    const statsParams = new URLSearchParams({ part: 'statistics', id: ids, key: apiKey })
    const statsRes = await fetch(`${VIDEOS_URL}?${statsParams}`)
    if (statsRes.ok) {
      const statsJson: YouTubeVideosResponse = await statsRes.json()
      const infoMap = new Map(
        (statsJson.items ?? []).map((item) => [
          item.id,
          {
            viewCount: item.statistics.viewCount ? parseInt(item.statistics.viewCount, 10) : null,
            likeCount: item.statistics.likeCount ? parseInt(item.statistics.likeCount, 10) : null,
          },
        ]),
      )
      const clips: VideoClip[] = baseClips.map((c) => ({
        ...c,
        ...(infoMap.get(c.videoId) ?? {}),
      }))
      if (clips.length > 0) cacheSet(key, clips, TTL.YOUTUBE)
      return clips
    }
    return baseClips
  } catch {
    return []
  }
}
```

#### `src/api/cache.ts` — localStorage キャッシュ（変更なしで移植可）

```typescript
export const TTL = {
  PLACES:  60 * 60 * 1000,
  YOUTUBE: 24 * 60 * 60 * 1000,
} as const

type CacheEntry<T> = { data: T; expiresAt: number }

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, expiresAt: Date.now() + ttlMs }))
  } catch {}
}

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (Date.now() > entry.expiresAt) { localStorage.removeItem(key); return null }
    return entry.data
  } catch { return null }
}

export function youtubeKey(placeId: string): string {
  return `omunhub_yt_${placeId}`
}
```

#### `src/utils/genre.ts` — YouTube 検索クエリ生成（変更なしで移植可）

```typescript
// ジャンル判定用の types マッピング
const GENRE_MAP: Record<string, string> = {
  japanese_restaurant: '和食',
  sushi_restaurant: '寿司',
  ramen_restaurant: 'ラーメン',
  italian_restaurant: 'イタリアン',
  chinese_restaurant: '中華',
  korean_restaurant: '韓国料理',
  french_restaurant: 'フレンチ',
  cafe: 'カフェ',
  bar: 'バー',
  bakery: 'ベーカリー',
  restaurant: '飲食店',
  food: '飲食店',
}

export function inferGenre(types: string[]): string {
  for (const t of types) {
    if (t in GENRE_MAP) return GENRE_MAP[t]
  }
  return '飲食店'
}

export function buildYouTubeQuery(restaurantName: string, areaName: string): string {
  // 「店名 エリア ショート」形式で検索
  const parts = [restaurantName]
  if (areaName && areaName !== '周辺') parts.push(areaName)
  parts.push('ショート')
  return parts.join(' ')
}
```

#### `src/types.ts` — 型定義（VideoClip のみ移植が必要）

```typescript
export type VideoClip = {
  videoId: string
  title: string
  channelTitle: string
  publishedAt: string   // ISO 8601
  thumbnail: string     // URL
  viewCount: number | null
  likeCount: number | null
}
```

#### `src/components/VideoModal.tsx` — フローティングプレイヤー（参考）

以下の機能を DOM 操作（React なし）で再実装してください：
- `position: fixed` でビューポート全体に浮かせる
- ドラッグで移動可能（パネル上部のドラッグハンドル）
- 右端ドラッグでリサイズ可能（幅 180〜500px）
- YouTube iframe 埋め込みで自動再生（`autoplay=1&rel=0`）
- 複数動画の前後ナビゲーション（`videos[idx]` を切り替える）
- hover 時のみタイトル・ナビを表示
- iframe 上の pointer-events 制御（ドラッグ中はブロック、hover 中は透過）
- 右上に × 閉じるボタン

---

### 実装手順（Phase 1 → Phase 2 の順で進めてください）

#### Phase 1 — MVP

1. **プロジェクトセットアップ**
   - `npm create vite@latest` + TypeScript
   - `vite-plugin-web-extension` を追加
   - `manifest.json` を設計書 Section 3 の通りに作成

2. **`api/cache.ts`** — 移植元コードをそのまま移植

3. **`api/youtube.ts`** — 移植元コードを移植。APIキー取得を引数渡しに変更済みのものを使用

4. **`utils/genre.ts`** — 移植元コードをそのまま移植

5. **`content/observer.ts`** — `MutationObserver` で InfoWindow を検知
   - `data-place-id` 属性を持つ要素を探す
   - 店名は `h2.fontHeadlineSmall` から取得
   - フォールバック: `[data-attrid="title"]`

6. **`content/infoWindowInjector.ts`** — 「▶ ショート動画」ボタンを注入
   - `[data-value="Directions"]` の親要素の隣に追加
   - `.mapshort-btn` が既存の場合はスキップ

7. **`content/videoPlayer.ts`** — フローティングプレイヤー（まず固定位置版で動作確認）

8. **`content/index.ts`** — 全体のエントリーポイント

9. **`popup/popup.html` + `popup.ts`** — YouTube API キー入力・保存

#### Phase 2 — UX 改善

10. プレイヤーのドラッグ移動
11. プレイヤーの右端リサイズ
12. hover 時のみ UI 表示（iframe の pointer-events 制御）
13. 複数動画の前後ナビゲーション
14. `localStorage` キャッシュの有効化

---

### 重要な実装注意事項

**Google Maps の DOM 構造について**  
- `data-place-id` 属性は現時点で存在するが、予告なく変更される可能性がある
- セレクターは必ず複数のフォールバックを実装すること
- `MutationObserver` のパフォーマンスに注意（subtree: true は重い）

**Manifest V3 の制約**  
- `eval` は使用不可
- 外部スクリプトの `src` 読み込みは不可（バンドルに含める）
- `content_security_policy` に `frame-src https://www.youtube.com` を追加すること

**CSS の名前空間**  
- Google Maps の既存スタイルと衝突しないよう、全クラスに `.mapshort-` プレフィックスを付ける

**APIキー管理**  
- YouTube API キーは `chrome.storage.sync` に保存する（`localStorage` は使わない）
- content script から取得するには `chrome.storage.sync.get('youtubeApiKey')` を使う

**クォータ管理**  
- YouTube Data API: `search.list` = 100 units/回、`videos.list` = 1 unit/回
- 無料枠: 10,000 units/日
- `localStorage` キャッシュ（TTL: 24h）で同じ店舗の重複リクエストを防ぐこと

---

### ブランドカラー

現行 Webアプリと統一してください：
- メインカラー: `#d87950`（オレンジ）
- ホバー: `#c06840`
- 背景（プレイヤー）: `#000`
- テキスト（プレイヤー上）: `#fff`

---

### 完成の定義

以下がすべて満たされた状態を完成とします：

- [ ] `npm run build` が通り `dist/` が生成される
- [ ] Chrome の「パッケージ化されていない拡張機能を読み込む」で `dist/` を読み込める
- [ ] Google Maps でマーカーをクリックすると InfoWindow に「▶ ショート動画」ボタンが表示される
- [ ] ボタンをクリックするとフローティングプレイヤーが表示され YouTube Shorts が自動再生される
- [ ] プレイヤーをドラッグして移動できる
- [ ] 閉じるボタンでプレイヤーが消える
- [ ] Popup で YouTube API キーを設定できる
- [ ] 同じ店舗の2回目以降はキャッシュから即座に動画が表示される
- [ ] TypeScript の型エラーがない（`tsc --noEmit` が通る）

---
