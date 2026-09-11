/**
 * background/service_worker.ts
 * MV3 Service Worker。インストール時の初期設定とメッセージルーティングを担当。
 */

// インストール時: デフォルト設定を書き込む
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set(
      { enabled: true, autoScan: true, maxResults: 10, scanInterval: 600 },
      () => { console.log('[mapshort] 初回インストール: デフォルト設定を保存しました') },
    )
  }
})

// popup からのメッセージを受け取る（現在は clearCache のみ）
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_YOUTUBE_SEARCH') {
    const query = typeof message.query === 'string' ? message.query : ''
    if (!query) {
      sendResponse({ ok: false, error: '検索語が空です' })
      return
    }
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    fetch(url, {
      headers: { Accept: 'text/html', 'Accept-Language': 'ja' },
    })
      .then(async (response) => {
        if (!response.ok) {
          sendResponse({ ok: false, error: `YouTube検索ページを取得できませんでした: ${response.status}` })
          return
        }
        sendResponse({ ok: true, html: await response.text() })
      })
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: `YouTube検索ページの取得に失敗しました: ${error instanceof Error ? error.message : 'network error'}`,
        })
      })
    return true
  }

  if (message.type === 'CLEAR_CACHE') {
    // content script 側の localStorage クリアは content script に委ねる
    // ここではタブに向けてクリア命令を転送する
    chrome.tabs.query({ url: ['*://www.google.com/maps/*', '*://maps.google.com/*'] }, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id != null) {
          chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_CACHE' }).catch(() => {
            // タブが応答しなくても無視
          })
        }
      })
      sendResponse({ ok: true })
    })
    return true // 非同期レスポンスのため true を返す
  }

  return false
})
