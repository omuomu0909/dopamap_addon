/**
 * popup/popup.ts
 * 拡張アイコンクリック時の設定画面のロジック。
 * - YouTube API キーの入力・保存（chrome.storage.sync）
 * - 有効/無効トグル
 * - キャッシュクリアボタン
 */

const toggleEl = document.getElementById('toggle-enabled') as HTMLInputElement
const apiKeyEl = document.getElementById('api-key') as HTMLInputElement
const saveBtnEl = document.getElementById('btn-save') as HTMLButtonElement
const clearBtnEl = document.getElementById('btn-clear-cache') as HTMLButtonElement
const statusEl = document.getElementById('status-msg') as HTMLDivElement

// ─────────────────────────────────────────────
// 初期表示: 保存済みの値を読み込む
// ─────────────────────────────────────────────

chrome.storage.sync.get(['youtubeApiKey', 'enabled'], (result) => {
  apiKeyEl.value = (result['youtubeApiKey'] as string) ?? ''
  toggleEl.checked = result['enabled'] !== false // デフォルト true
})

// ─────────────────────────────────────────────
// トグル変更時: 即座に保存
// ─────────────────────────────────────────────

toggleEl.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: toggleEl.checked }, () => {
    showStatus(toggleEl.checked ? '有効にしました' : '無効にしました')
  })
})

// ─────────────────────────────────────────────
// 保存ボタン
// ─────────────────────────────────────────────

saveBtnEl.addEventListener('click', () => {
  const key = apiKeyEl.value.trim()
  if (!key) {
    showStatus('APIキーを入力してください', true)
    return
  }
  chrome.storage.sync.set({ youtubeApiKey: key }, () => {
    showStatus('保存しました ✓')
  })
})

// ─────────────────────────────────────────────
// キャッシュクリアボタン
// ─────────────────────────────────────────────

clearBtnEl.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, () => {
    showStatus('キャッシュをクリアしました')
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
