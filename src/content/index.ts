/**
 * content/index.ts
 * maps.google.com に注入されるエントリーポイント。
 *
 * 設計:
 *   - SidePanel を生成して右端に固定表示
 *   - InfoWindowObserver が店舗変化を通知する
 *   - 通知が来たら SidePanel を「読み込み中」状態にリセット
 *   - 300ms debounce: 連打中は検索せず、止まったら最新店舗だけ検索
 *   - 検索完了後に SidePanel を「件数ボタン」状態に更新
 *   - スキャンボタンで listScanner を起動／停止
 */

import { clearAllCache } from '../api/cache'
import { InfoWindowObserver } from './observer'
import { SidePanel } from './sidePanel'
import { searchVideos } from '../api/youtube'
import { extractAreaName, extractCategory } from '../utils/placeId'
import { startListScan, stopListScan, hasListRows } from './listScanner'

/** debounce 用タイマー */
let debounceTimer: ReturnType<typeof setTimeout> | null = null
/** 進行中の検索を識別するシーケンス番号（グローバル単調増加） */
let searchSeq = 0

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

  const panel = new SidePanel()

  // スキャンボタンのコールバックを登録
  panel.onScan(
    () => startListScan(panel),
    () => stopListScan(),
  )

  const observer = new InfoWindowObserver((name, panelEl) => {
    // 詳細パネルが開いたらリストスキャンを停止
    stopListScan()

    panel.destroyPlayer()

    // ① 即座にサイドパネルを「読み込み中」に更新
    panel.setCurrentPlace({ status: 'loading', name })

    // ② debounce: 連打中はタイマーをリセットし続け、止まったら検索
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      startSearch(name, panelEl, panel)
    }, 300)
  })

  observer.start()

  // 検索結果リスト（居酒屋一覧など）が表示されているときにスキャンボタンを有効化
  // （ユーザーがボタンを押したときに startListScan を呼ぶ）
  // 初期表示時にリストがすでにあればスキャンを自動開始
  if (hasListRows()) {
    startListScan(panel)
  } else {
    const listWatcher = new MutationObserver(() => {
      if (hasListRows()) {
        listWatcher.disconnect()
        // リストが現れたら自動スキャン
        startListScan(panel)
      }
    })
    listWatcher.observe(document.body, { childList: true, subtree: true })
  }
}

/** debounce 後に実際の検索を行う */
async function startSearch(
  name: string,
  panelEl: Element,
  panel: SidePanel,
): Promise<void> {
  const seq = ++searchSeq

  const cacheKey = name
  const areaName = extractAreaName(panelEl)
  const category = extractCategory(panelEl)
  const query = [areaName, name, category].filter(Boolean).join(' ')

  let result
  try {
    result = await searchVideos(name, areaName, cacheKey, 10, category)
  } catch (err) {
    if (seq !== searchSeq) return
    const msg = err instanceof Error ? err.message : '動画の取得に失敗しました'
    panel.setCurrentPlace({ status: 'error', name, message: msg, query })
    return
  }

  if (seq !== searchSeq) return

  const { shorts, videos, shortsTotal, videosTotal } = result

  if (shortsTotal === 0 && videosTotal === 0) {
    panel.setCurrentPlace({ status: 'empty', name, query })
    return
  }

  panel.setCurrentPlace({ status: 'ready', name, shorts, videos, shortsTotal, videosTotal, query })
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CLEAR_CACHE') {
    clearAllCache()
  }
})

main().catch(console.error)
