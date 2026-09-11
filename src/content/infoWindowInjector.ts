/**
 * content/infoWindowInjector.ts
 * Google Maps のサイドパネルに「▶ ショート動画」ボタンを注入する。
 *
 * 責務:
 *   - パネルにボタンがなければ追加する
 *   - すでにボタンがある場合は何もしない（onClick は同じ店舗のまま有効）
 *   - クリーンアップ関数を返す
 */

export function injectShortsButton(
  panelEl: Element,
  onClick: () => void | Promise<void>,
): () => void {
  // すでに注入済みなら何もしない（多重注入・ループ防止）
  if (panelEl.querySelector('.mapshort-btn')) return () => {}

  const btn = document.createElement('button')
  btn.className = 'mapshort-btn'
  btn.type = 'button'
  btn.innerHTML = `
    <span class="mapshort-btn-icon">▶</span>
    <span class="mapshort-btn-label">ショート動画</span>
  `
  let isLoading = false
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (isLoading) return

    isLoading = true
    btn.disabled = true
    btn.classList.add('mapshort-btn-loading')
    const label = btn.querySelector('.mapshort-btn-label')
    if (label) label.textContent = '読み込み中…'

    // Promise 化して同期・非同期どちらのコールバックでも、完了時に再試行可能にする。
    Promise.resolve(onClick()).finally(() => {
      isLoading = false
      btn.disabled = false
      btn.classList.remove('mapshort-btn-loading')
      if (label) label.textContent = 'ショート動画'
    }).catch(() => undefined)
  })

  const actionBar = findActionBar(panelEl)
  if (actionBar) {
    actionBar.appendChild(btn)
  } else {
    const h1 = panelEl.querySelector('h1')
    const insertTarget = h1?.parentElement ?? panelEl
    insertTarget.appendChild(btn)
  }

  return () => btn.remove()
}

/**
 * アクションボタン行（ルート・保存・共有 などが並ぶ DIV）を探す。
 */
function findActionBar(panel: Element): Element | null {
  // aria-label に「ルート」を含むボタンの祖先で子が 3 つ以上ある DIV
  const routeBtn = Array.from(panel.querySelectorAll('button[aria-label]')).find((b) =>
    (b.getAttribute('aria-label') ?? '').includes('ルート'),
  )
  if (routeBtn) {
    let el: Element | null = routeBtn.parentElement
    for (let i = 0; i < 6 && el; i++) {
      if (el.children.length >= 3) return el
      el = el.parentElement
    }
  }
  return null
}
