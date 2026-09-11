/**
 * content/listScanner.ts
 * Google Maps の検索結果リスト（居酒屋一覧など）を監視し、
 * 各行の動画情報を SidePanel に通知する。
 *
 * 動作:
 *   - リスト行 (.Nv2PK) が DOM に存在したらスキャン開始
 *   - 各行から店舗名を取得して YouTube 検索（逐次・レート制限あり）
 *   - 結果を SidePanel の addListItem / updateListItem 経由で表示
 *   - リストが再描画されたら前のスキャンをキャンセルして再スキャン
 */

import { searchVideos } from '../api/youtube'
import type { SidePanel } from './sidePanel'

/** リスト行セレクタ（DevTools で確認済み） */
const ROW_SEL = '.Nv2PK'
/** 店舗名を含む要素のセレクタ候補（優先順） */
const NAME_SEL = ['.qBF1Pd', '.fontHeadlineSmall', 'h3', 'h2']
/** スキャン間隔（YouTube レート制限 500ms より少し大きめ） */
const SCAN_INTERVAL_MS = 600

let scanAbortController: AbortController | null = null
let listObserver: MutationObserver | null = null

/**
 * リストスキャンを開始する。
 * すでに実行中なら停止してから再開する。
 */
export function startListScan(panel: SidePanel): void {
  stopListScan()

  const rows = document.querySelectorAll(ROW_SEL)
  if (rows.length === 0) return

  panel.clearList()
  panel.setScanningState(true)

  const ac = new AbortController()
  scanAbortController = ac
  runScan(ac.signal, panel).then(() => {
    if (!ac.signal.aborted) panel.setScanningState(false)
  })

  // リストの変化を監視（スクロールで行が追加されたとき）
  const listContainer = rows[0].closest('[role="feed"]') ?? rows[0].parentElement
  if (listContainer) {
    listObserver = new MutationObserver(() => {
      const unscanned = Array.from(listContainer.querySelectorAll(`${ROW_SEL}:not([data-mapshort-scanned])`))
      if (unscanned.length > 0) {
        ac.abort()
        scanAbortController = null
        const newAc = new AbortController()
        scanAbortController = newAc
        runScan(newAc.signal, panel).then(() => {
          if (!newAc.signal.aborted) panel.setScanningState(false)
        })
      }
    })
    listObserver.observe(listContainer, { childList: true })
  }
}

/** スキャンを停止する */
export function stopListScan(): void {
  scanAbortController?.abort()
  scanAbortController = null
  listObserver?.disconnect()
  listObserver = null
  // スキャン済みマークを除去（次回スキャン時に再取得できるよう）
  document.querySelectorAll(`[data-mapshort-scanned]`).forEach(el => {
    (el as HTMLElement).removeAttribute('data-mapshort-scanned')
  })
}

/** 検索結果リストが存在するかチェック */
export function hasListRows(): boolean {
  return document.querySelectorAll(ROW_SEL).length > 0
}

async function runScan(signal: AbortSignal, panel: SidePanel): Promise<void> {
  const rows = Array.from(document.querySelectorAll(ROW_SEL)) as HTMLElement[]

  for (const row of rows) {
    if (signal.aborted) return
    if (row.dataset.mapshortScanned) continue

    row.dataset.mapshortScanned = '1'

    const name = extractNameFromRow(row)
    if (!name) continue

    panel.addListItem({ name, status: 'scanning', mapRow: row })

    if (signal.aborted) return

    try {
      const result = await searchVideos(name, '', name)
      if (signal.aborted) return

      const { shorts, videos, shortsTotal, videosTotal } = result

      if (shortsTotal === 0 && videosTotal === 0) {
        panel.updateListItem({ name, status: 'empty', mapRow: row })
        continue
      }

      panel.updateListItem({ name, status: 'ready', shorts, videos, shortsTotal, videosTotal, mapRow: row })
    } catch {
      panel.updateListItem({ name, status: 'empty', mapRow: row })
    }

    await sleep(SCAN_INTERVAL_MS, signal)
  }
}

function extractNameFromRow(row: HTMLElement): string | null {
  for (const sel of NAME_SEL) {
    const el = row.querySelector(sel)
    if (el?.textContent?.trim()) return el.textContent.trim()
  }
  return null
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) }, { once: true })
  })
}
