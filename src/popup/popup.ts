/**
 * popup/popup.ts
 * 拡張アイコンクリック時の設定画面のロジック。
 * - 有効/無効トグル
 * - 自動スキャン トグル
 * - 動画の最大表示件数スライダー
 * - スキャン間隔スライダー
 * - キャッシュクリアボタン
 */

const toggleEl       = document.getElementById('toggle-enabled')       as HTMLInputElement
const autoScanEl     = document.getElementById('toggle-auto-scan')     as HTMLInputElement
const maxResultsEl   = document.getElementById('max-results')          as HTMLInputElement
const maxResultsVal  = document.getElementById('max-results-value')    as HTMLSpanElement
const scanIntervalEl = document.getElementById('scan-interval')        as HTMLInputElement
const scanIntervalVal= document.getElementById('scan-interval-value')  as HTMLSpanElement
const pollIntervalEl = document.getElementById('poll-interval')        as HTMLInputElement
const pollIntervalVal= document.getElementById('poll-interval-value')  as HTMLSpanElement
const shortWidthEl      = document.getElementById('short-width')           as HTMLInputElement
const shortWidthVal     = document.getElementById('short-width-value')     as HTMLSpanElement
const landscapeWidthEl  = document.getElementById('landscape-width')       as HTMLInputElement
const landscapeWidthVal = document.getElementById('landscape-width-value') as HTMLSpanElement
const saveBtnEl         = document.getElementById('btn-save')              as HTMLButtonElement
const clearBtnEl     = document.getElementById('btn-clear-cache')      as HTMLButtonElement
const statusEl       = document.getElementById('status-msg')           as HTMLDivElement
const themeDarkBtn   = document.getElementById('theme-dark')           as HTMLButtonElement
const themeLightBtn  = document.getElementById('theme-light')          as HTMLButtonElement
const presetInput    = document.getElementById('preset-input')         as HTMLInputElement
const presetAddBtn   = document.getElementById('preset-add-btn')       as HTMLButtonElement
const presetListEl   = document.getElementById('preset-list')          as HTMLDivElement

// ─────────────────────────────────────────────
// 初期表示: 保存済みの値を読み込む
// ─────────────────────────────────────────────

chrome.storage.sync.get(
  ['enabled', 'autoScan', 'maxResults', 'scanInterval', 'pollInterval', 'shortWidth', 'landscapeWidth', 'theme', 'channelPresets'],
  (result) => {
    toggleEl.checked       = result['enabled']   !== false       // デフォルト true
    autoScanEl.checked     = result['autoScan']  !== false       // デフォルト true
    const maxR             = (result['maxResults']      as number) ?? 10
    const scanMs           = (result['scanInterval']    as number) ?? 600
    const pollMs           = (result['pollInterval']    as number) ?? 100
    const shortW           = (result['shortWidth']      as number) ?? 420
    const landscapeW       = (result['landscapeWidth']  as number) ?? 960
    maxResultsEl.value     = String(maxR)
    maxResultsVal.textContent = `${maxR} 件`
    scanIntervalEl.value   = String(scanMs)
    scanIntervalVal.textContent = `${scanMs} ms`
    pollIntervalEl.value   = String(pollMs)
    pollIntervalVal.textContent = `${pollMs} ms`
    shortWidthEl.value     = String(shortW)
    shortWidthVal.textContent = `${shortW} px`
    landscapeWidthEl.value = String(landscapeW)
    landscapeWidthVal.textContent = `${landscapeW} px`
    setActiveTheme((result['theme'] as 'dark' | 'light') ?? 'light')
    renderPresets((result['channelPresets'] as string[]) ?? [])
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

pollIntervalEl.addEventListener('input', () => {
  pollIntervalVal.textContent = `${pollIntervalEl.value} ms`
})

shortWidthEl.addEventListener('input', () => {
  shortWidthVal.textContent = `${shortWidthEl.value} px`
})

landscapeWidthEl.addEventListener('input', () => {
  landscapeWidthVal.textContent = `${landscapeWidthEl.value} px`
})

// ─────────────────────────────────────────────
// トグル変更時: 即座に保存
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// テーマ選択ボタン
// ─────────────────────────────────────────────

function setActiveTheme(theme: 'dark' | 'light'): void {
  themeDarkBtn.classList.toggle('active', theme === 'dark')
  themeLightBtn.classList.toggle('active', theme === 'light')
}

themeDarkBtn.addEventListener('click', () => {
  setActiveTheme('dark')
  chrome.storage.sync.set({ theme: 'dark' })
})

themeLightBtn.addEventListener('click', () => {
  setActiveTheme('light')
  chrome.storage.sync.set({ theme: 'light' })
})

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
  const maxResults     = Number(maxResultsEl.value)
  const scanInterval   = Number(scanIntervalEl.value)
  const pollInterval   = Number(pollIntervalEl.value)
  const shortWidth     = Number(shortWidthEl.value)
  const landscapeWidth = Number(landscapeWidthEl.value)
  chrome.storage.sync.set({ maxResults, scanInterval, pollInterval, shortWidth, landscapeWidth }, () => {
    window.close()
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

// ─────────────────────────────────────────────
// 投稿者プリセット管理
// ─────────────────────────────────────────────

function renderPresets(presets: string[]): void {
  presetListEl.innerHTML = ''
  if (presets.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'preset-empty'
    empty.textContent = '登録済みの投稿者はいません'
    presetListEl.appendChild(empty)
    return
  }
  for (const name of presets) {
    const item = document.createElement('div')
    item.className = 'preset-item'

    const nameEl = document.createElement('span')
    nameEl.className = 'preset-item__name'
    nameEl.textContent = name
    item.appendChild(nameEl)

    const delBtn = document.createElement('button')
    delBtn.className = 'preset-item__del'
    delBtn.type = 'button'
    delBtn.textContent = '✕'
    delBtn.title = '削除'
    delBtn.addEventListener('click', () => removePreset(name))
    item.appendChild(delBtn)

    presetListEl.appendChild(item)
  }
}

function getPresets(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get('channelPresets', (r) => {
      resolve((r['channelPresets'] as string[]) ?? [])
    })
  })
}

async function addPreset(name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  const presets = await getPresets()
  if (presets.includes(trimmed)) return
  const next = [...presets, trimmed]
  chrome.storage.sync.set({ channelPresets: next }, () => renderPresets(next))
}

async function removePreset(name: string): Promise<void> {
  const presets = await getPresets()
  const next = presets.filter(p => p !== name)
  chrome.storage.sync.set({ channelPresets: next }, () => renderPresets(next))
}

presetAddBtn.addEventListener('click', () => {
  addPreset(presetInput.value)
  presetInput.value = ''
})

presetInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addPreset(presetInput.value)
    presetInput.value = ''
  }
})
