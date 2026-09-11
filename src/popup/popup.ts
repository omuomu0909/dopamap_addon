/**
 * popup/popup.ts
 * 拡張アイコンクリック時の設定画面のロジック。
 * - 有効/無効トグル
 * - 自動スキャン トグル
 * - 動画の最大表示件数スライダー
 * - スキャン間隔スライダー
 * - 追加キーワード入力
 * - キャッシュクリアボタン
 */

const toggleEl       = document.getElementById('toggle-enabled')       as HTMLInputElement
const autoScanEl     = document.getElementById('toggle-auto-scan')     as HTMLInputElement
const maxResultsEl   = document.getElementById('max-results')          as HTMLInputElement
const maxResultsVal  = document.getElementById('max-results-value')    as HTMLSpanElement
const scanIntervalEl = document.getElementById('scan-interval')        as HTMLInputElement
const scanIntervalVal= document.getElementById('scan-interval-value')  as HTMLSpanElement
const extraKeywordEl = document.getElementById('extra-keyword')        as HTMLInputElement
const saveBtnEl      = document.getElementById('btn-save')             as HTMLButtonElement
const clearBtnEl     = document.getElementById('btn-clear-cache')      as HTMLButtonElement
const statusEl       = document.getElementById('status-msg')           as HTMLDivElement

// ─────────────────────────────────────────────
// 初期表示: 保存済みの値を読み込む
// ─────────────────────────────────────────────

chrome.storage.sync.get(
  ['enabled', 'autoScan', 'maxResults', 'scanInterval', 'extraKeyword'],
  (result) => {
    toggleEl.checked       = result['enabled']   !== false       // デフォルト true
    autoScanEl.checked     = result['autoScan']  !== false       // デフォルト true
    const maxR             = (result['maxResults']   as number) ?? 10
    const scanMs           = (result['scanInterval'] as number) ?? 600
    maxResultsEl.value     = String(maxR)
    maxResultsVal.textContent = `${maxR} 件`
    scanIntervalEl.value   = String(scanMs)
    scanIntervalVal.textContent = `${scanMs} ms`
    extraKeywordEl.value   = (result['extraKeyword'] as string) ?? ''
  },
)

// ─────────────────────────────────────────────
// スライダー: リアルタイムでラベルを更新
// ─────────────────────────────────────────────

maxResultsEl.addEventListener('input', () => {
  maxResultsVal.textContent = `${maxResultsEl.value} 件`
})

scanIntervalEl.addEventListener('input', () => {
  scanIntervalVal.textContent = `${scanIntervalEl.value} ms`
})

// ─────────────────────────────────────────────
// トグル変更時: 即座に保存
// ─────────────────────────────────────────────

toggleEl.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: toggleEl.checked }, () => {
    showStatus(toggleEl.checked ? '有効にしました' : '無効にしました')
  })
})

autoScanEl.addEventListener('change', () => {
  chrome.storage.sync.set({ autoScan: autoScanEl.checked }, () => {
    showStatus(autoScanEl.checked ? '自動スキャン: オン' : '自動スキャン: オフ')
  })
})

// ─────────────────────────────────────────────
// 保存ボタン
// ─────────────────────────────────────────────

saveBtnEl.addEventListener('click', () => {
  const extraKeyword  = extraKeywordEl.value.trim()
  const maxResults    = Number(maxResultsEl.value)
  const scanInterval  = Number(scanIntervalEl.value)
  chrome.storage.sync.set({ extraKeyword, maxResults, scanInterval }, () => {
    showStatus('保存しました ✓')
  })
})

// ─────────────────────────────────────────────
// キャッシュクリアボタン
// ─────────────────────────────────────────────

clearBtnEl.addEventListener('click', () => {
  // 全タブを取得して URL で Maps タブを絞り込む
  // （tabs.query の url フィルタは host_permissions との組み合わせで動作しないケースがあるため）
  chrome.tabs.query({}, (allTabs) => {
    const mapsTabs = allTabs.filter(t =>
      t.id != null &&
      typeof t.url === 'string' &&
      /https:\/\/(www\.google\.(com|co\.jp)|maps\.google\.(com|co\.jp))\/maps\//.test(t.url),
    )
    if (mapsTabs.length === 0) {
      showStatus('Maps タブが見つかりません', true)
      return
    }
    let done = 0
    for (const tab of mapsTabs) {
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id! },
          func: () => {
            const keys: string[] = []
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i)
              if (k?.startsWith('mapshort:')) keys.push(k)
            }
            keys.forEach(k => localStorage.removeItem(k))
            return keys.length
          },
        },
        (results) => {
          done++
          if (done === mapsTabs.length) {
            const count = results?.[0]?.result ?? 0
            showStatus(`キャッシュをクリアしました（${count} 件）`)
          }
        },
      )
    }
  })
})

// ─────────────────────────────────────────────
// ステータスメッセージ（一時表示）
// ─────────────────────────────────────────────

let statusTimer: ReturnType<typeof setTimeout> | null = null

function showStatus(msg: string, isError = false): void {
  statusEl.textContent = msg
  statusEl.className = 'status-msg' + (isError ? ' error' : '')
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    statusEl.textContent = ''
  }, 3000)
}
