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
 *   - 検索結果リストが出現・差し替わったら自動でリストスキャンを起動
 */

import { clearAllCache } from '../api/cache'
import { InfoWindowObserver } from './observer'
import { SidePanel } from './sidePanel'
import { searchVideos } from '../api/youtube'
import { extractAreaName, extractCategory } from '../utils/placeId'
import { startListScan, stopListScan, hasListRows, isScanning, hasScannedRows } from './listScanner'

/** debounce 用タイマー */
let debounceTimer: ReturnType<typeof setTimeout> | null = null
/** 進行中の検索を識別するシーケンス番号（グローバル単調増加） */
let searchSeq = 0
/** 直前に検索した店舗情報（キーワード変更時の再検索用） */
let lastSearchContext: { name: string; panelEl: Element } | null = null

/** 拡張が有効かどうかを確認 */
async function isEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get('enabled', (result) => {
      resolve(result['enabled'] !== false)
    })
  })
}

/** storage から各種設定を読む */
async function loadSettings(): Promise<{
  extraKeyword: string
  channelFilter: import('./sidePanel').ChannelFilter
  autoScan: boolean
  maxResults: number
  scanInterval: number
}> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['extraKeyword', 'channelFilter', 'autoScan', 'maxResults', 'scanInterval'], (result) => {
      resolve({
        extraKeyword:  (result['extraKeyword']  as string)  ?? '',
        channelFilter: (result['channelFilter'] as import('./sidePanel').ChannelFilter) ?? { text: '', mode: 'partial' },
        autoScan:      result['autoScan']   !== false,
        maxResults:    (result['maxResults']   as number)   ?? 10,
        scanInterval:  (result['scanInterval'] as number)   ?? 600,
      })
    })
  })
}

/** メインエントリー */
async function main(): Promise<void> {
  if (!(await isEnabled())) return

  const panel = new SidePanel()

  // storage の初期値をパネルに反映
  const { extraKeyword: initialKw, channelFilter: initialCf, autoScan: initialAutoScan, maxResults: initialMaxResults, scanInterval: initialScanInterval } = await loadSettings()
  panel.setExtraKeyword(initialKw)
  panel.setChannelFilter(initialCf)

  // スキャンボタンのコールバックを登録（キーワード・フィルタはその時点のものを使う）
  panel.onScan(
    () => startListScan(panel, panel.getExtraKeyword(), panel.getChannelFilter(), initialScanInterval, initialMaxResults),
    () => stopListScan(),
  )

  // 追加キーワード変更: storage 保存 + 再検索 + 再スキャン
  panel.onExtraKeyword((kw) => {
    chrome.storage.sync.set({ extraKeyword: kw })
    if (lastSearchContext) {
      const { name, panelEl } = lastSearchContext
      panel.setCurrentPlace({ status: 'loading', name })
      startSearch(name, panelEl, panel, kw, panel.getChannelFilter(), initialMaxResults)
    }
    if (isScanning()) startListScan(panel, kw, panel.getChannelFilter(), initialScanInterval, initialMaxResults)
  })

  // 投稿者フィルタ変更: storage 保存 + 再検索 + 再スキャン
  panel.onChannelFilter((cf) => {
    chrome.storage.sync.set({ channelFilter: cf })
    if (lastSearchContext) {
      const { name, panelEl } = lastSearchContext
      panel.setCurrentPlace({ status: 'loading', name })
      startSearch(name, panelEl, panel, panel.getExtraKeyword(), cf, initialMaxResults)
    }
    if (isScanning()) startListScan(panel, panel.getExtraKeyword(), cf, initialScanInterval, initialMaxResults)
  })

  const observer = new InfoWindowObserver((name, panelEl) => {
    console.log('[mapshort] onDetect callback:', name)
    // 詳細パネルが開いたらリストスキャンを停止
    stopListScan()

    // 直前の検索コンテキストを保存（キーワード変更時の再検索用）
    lastSearchContext = { name, panelEl }

    // ① 即座にサイドパネルを「読み込み中」に更新
    panel.setCurrentPlace({ status: 'loading', name })

    // ② debounce: 連打中はタイマーをリセットし続け、止まったら検索
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      console.log('[mapshort] debounce fired, calling startSearch:', name)
      startSearch(name, panelEl, panel, panel.getExtraKeyword(), panel.getChannelFilter())
    }, 300)
  })

  observer.start()

  // 検索結果リスト（居酒屋一覧など）が表示されたら自動スキャン
  // ・初期表示時にリストがすでにあれば即スキャン
  // ・なければ DOM 監視でリスト出現 or 差し替えを検知して自動スキャン
  watchAndAutoScan(panel, initialAutoScan, initialScanInterval, initialMaxResults)
}

/**
 * 検索結果リストの出現・差し替えを監視して自動スキャンを起動する。
 *
 * Google Maps の検索時の動き:
 *   1. URL が /maps/search/... に変わる
 *   2. 既存のリスト行 (.Nv2PK) が一旦消えて新しいリスト行が追加される
 *   3. スクロールで行が追加される（listScanner の listObserver が担当）
 *
 * 検知戦略:
 *   - history.pushState / replaceState を hook して URL 変化を検知
 *   - popstate イベントも監視
 *   - URL が変わったあと、リスト行が揃ったタイミングで startListScan を呼ぶ
 *   - URL 変化なしでも、リスト行が差し替わった（全消し→新規追加）を
 *     MutationObserver で検知して startListScan を呼ぶ
 */
function watchAndAutoScan(panel: SidePanel, autoScan = true, scanInterval = 600, maxResults = 10): void {
  // 初期表示時にリストがすでにあれば即スキャン
  if (autoScan && hasListRows()) {
    startListScan(panel, panel.getExtraKeyword(), panel.getChannelFilter(), scanInterval, maxResults)
  }

  // URL ベースの変化検知: pushState / replaceState hook + popstate
  let lastUrl = location.href

  function onUrlChange(): void {
    const newUrl = location.href
    if (newUrl === lastUrl) return
    lastUrl = newUrl
    // URL が変わったらリスト行出現を待って自動スキャン（autoScan ON 時のみ）
    if (autoScan) waitForListAndScan(panel, scanInterval, maxResults)
  }

  // pushState / replaceState を hook
  const origPushState = history.pushState.bind(history)
  const origReplaceState = history.replaceState.bind(history)
  history.pushState = function (...args) {
    origPushState(...args)
    onUrlChange()
  }
  history.replaceState = function (...args) {
    origReplaceState(...args)
    onUrlChange()
  }
  window.addEventListener('popstate', onUrlChange)

  // MutationObserver でリスト行の出現も直接監視
  // （URL が変わらないケースや hook が間に合わないケースに備える）
  //
  // ガード戦略:
  //   - スキャン中でも「未スキャン行が Google Maps のリストにある」場合は
  //     新しい検索結果が来たとみなして再スキャンする
  //   - サイドパネル側 (msp-list) の DOM 変更はスキャン済みマークが付いた
  //     行を追加するため、未スキャン行の存在チェックで区別できる
  if (autoScan) {
    let listWatchTimer: ReturnType<typeof setTimeout> | null = null
    const listWatcher = new MutationObserver(() => {
      if (!hasListRows()) return
      // 「スキャン済み行が 1 件以上ある」= 現在スキャン中 or スキャン完了後の行
      // その状態でさらに未スキャン行が追加された場合はスクロール追加であり、
      // listScanner 内の listObserver が担当するためここでは無視する
      if (hasScannedRows()) return
      // スキャン済み行がゼロ＝全行が新規（URL 変化後の新しい検索結果）のみ対応
      if (isScanning()) return
      // debounce: DOM が落ち着くまで少し待つ
      if (listWatchTimer !== null) clearTimeout(listWatchTimer)
      listWatchTimer = setTimeout(() => {
        listWatchTimer = null
        startListScan(panel, panel.getExtraKeyword(), panel.getChannelFilter(), scanInterval, maxResults)
      }, 300)
    })
    listWatcher.observe(document.body, { childList: true, subtree: true })
  }
}

/**
 * リスト行が DOM に現れるのを最大 5 秒待って startListScan を呼ぶ。
 * 既にリスト行があれば即スキャン。
 */
function waitForListAndScan(panel: SidePanel, scanInterval = 600, maxResults = 10): void {
  if (hasListRows()) {
    startListScan(panel, panel.getExtraKeyword(), panel.getChannelFilter(), scanInterval, maxResults)
    return
  }
  let elapsed = 0
  const INTERVAL = 200
  const MAX_WAIT = 5000
  const timer = setInterval(() => {
    elapsed += INTERVAL
    if (hasListRows()) {
      clearInterval(timer)
      startListScan(panel, panel.getExtraKeyword(), panel.getChannelFilter(), scanInterval, maxResults)
    } else if (elapsed >= MAX_WAIT) {
      clearInterval(timer)
    }
  }, INTERVAL)
}

/** debounce 後に実際の検索を行う */
async function startSearch(
  name: string,
  panelEl: Element,
  panel: SidePanel,
  extraKeyword = '',
  channelFilter: import('./sidePanel').ChannelFilter = { text: '', mode: 'partial' },
  maxResults = 10,
): Promise<void> {
  const seq = ++searchSeq

  const cacheKey = `${name}:${extraKeyword}:ch:${channelFilter.text}:${channelFilter.mode}`
  const areaName = extractAreaName(panelEl)
  const category = extractCategory(panelEl)
  const query = [areaName, name, category, extraKeyword].filter(Boolean).join(' ')

  console.log('[mapshort] startSearch:', { name, areaName, category, extraKeyword, cacheKey })

  let result
  try {
    result = await searchVideos(name, areaName, cacheKey, maxResults, category, extraKeyword, channelFilter)
    console.log('[mapshort] searchVideos result:', result)
  } catch (err) {
    console.error('[mapshort] searchVideos error:', err)
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
