/**
 * content/index.ts
 * maps.google.com に注入されるエントリーポイント。
 *
 * 設計:
 *   - InfoWindowObserver は「店舗が変わった」ときだけ onDetect を呼ぶ
 *   - onDetect では前のボタンを除去してから新しいボタンを注入する
 *   - ボタンクリック時のみ YouTube API を呼び出す（自動呼び出しなし）
 */

import { clearAllCache } from '../api/cache'
import { InfoWindowObserver } from './observer'
import { injectShortsButton } from './infoWindowInjector'
import { VideoPlayer } from './videoPlayer'
import { searchShorts } from '../api/youtube'
import { buildYouTubeQuery, buildFallbackQuery } from '../utils/genre'
import { extractPlaceIdFromUrl } from '../utils/placeId'

let currentPlayer: VideoPlayer | null = null
/** 直前に注入したボタンのクリーンアップ関数 */
let cleanupButton: (() => void) | null = null

/** 拡張が有効かどうかを確認 */
async function isEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get('enabled', (result) => {
      resolve(result['enabled'] !== false)
    })
  })
}

/** メインエントリー */
async function main(): Promise<void> {
  if (!(await isEnabled())) return

  const observer = new InfoWindowObserver((placeId, name, panelEl) => {
    // 前の店舗のボタンを除去
    cleanupButton?.()
    cleanupButton = null

    // 新しい店舗のボタンを注入
    // onClick はこのクロージャで placeId/name を閉じ込める
    cleanupButton = injectShortsButton(panelEl, async () => {
      // 既存プレイヤーを閉じる
      currentPlayer?.destroy()
      currentPlayer = null

      const resolvedPlaceId = placeId || extractPlaceIdFromUrl() || ''
      const cacheKey = resolvedPlaceId || name
      const query = resolvedPlaceId ? buildYouTubeQuery(name) : buildFallbackQuery(name)

      const loadingEl = createLoadingEl(name, panelEl)
      document.body.appendChild(loadingEl)

      try {
        const videos = await searchShorts(query, cacheKey)
        loadingEl.remove()
        if (videos.length === 0) {
          showError(name, '動画が見つかりませんでした', panelEl)
          return
        }
        currentPlayer = new VideoPlayer(videos, name, panelEl)
      } catch (err) {
        loadingEl.remove()
        const msg = err instanceof Error ? err.message : '動画の取得に失敗しました'
        showError(name, msg, panelEl)
      }
    })
  })

  observer.start()
}

function createLoadingEl(name: string, panelEl?: Element): HTMLElement {
  const el = document.createElement('div')
  el.className = 'mapshort-player'
  el.style.cssText = playerPosition(panelEl)
  el.innerHTML = `
    <div class="mapshort-player-inner">
      <div class="mapshort-player-drag-handle">
        <span class="mapshort-player-title-bar">${escapeHtml(name)}</span>
      </div>
      <div class="mapshort-player-loading">読み込み中…</div>
    </div>
  `
  return el
}

function showError(name: string, message: string, panelEl?: Element): void {
  const el = document.createElement('div')
  el.className = 'mapshort-player'
  el.style.cssText = playerPosition(panelEl)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'mapshort-player-close'
  closeBtn.type = 'button'
  closeBtn.textContent = '✕'
  closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:1;'
  closeBtn.addEventListener('click', () => el.remove())

  el.innerHTML = `
    <div class="mapshort-player-inner">
      <div class="mapshort-player-drag-handle">
        <span class="mapshort-player-title-bar">${escapeHtml(name)}</span>
      </div>
      <div class="mapshort-player-error">
        <span>⚠️</span>
        <span>${escapeHtml(message)}</span>
      </div>
    </div>
  `
  el.appendChild(closeBtn)
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 5000)
}

function playerPosition(panelEl?: Element): string {
  const rect = panelEl?.getBoundingClientRect()
  const width = 420
  const rightCandidate = rect ? rect.right + 16 : window.innerWidth - width - 16
  const leftCandidate = rect ? rect.left - width - 16 : rightCandidate
  const left = rect && rightCandidate + width <= window.innerWidth
    ? rightCandidate
    : rect && leftCandidate >= 12
      ? leftCandidate
      : window.innerWidth - width - 16
  const top = rect ? Math.max(12, rect.top) : 16
  return `top:${top}px;left:${Math.max(12, left)}px;width:${width}px;`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CLEAR_CACHE') {
    clearAllCache()
  }
})

main().catch(console.error)
