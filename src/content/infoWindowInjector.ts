/**
 * content/infoWindowInjector.ts
 * 画面固定バー（mapshort-bar）を管理する。
 *
 * Google Maps のパネル要素（panelEl）には一切注入しない。
 * 独立した固定コンテナを document.body に1つだけ持ち、
 * 店舗切替のたびに内容を上書きする。
 * これにより panelEl の使い回し・非同期競合を完全に回避する。
 */

import type { VideoClip } from './videoPlayer'

export type BarContent =
  | { status: 'loading'; placeName: string }
  | {
      status: 'ready'
      placeName: string
      shorts: VideoClip[]
      videos: VideoClip[]
      shortsTotal: number
      videosTotal: number
      onClickShorts: () => void
      onClickVideos: () => void
    }
  | { status: 'error'; placeName: string; message: string }
  | { status: 'empty' }

const BAR_ID = 'mapshort-bar'

/** 固定バーを取得または作成する */
function getOrCreateBar(): HTMLElement {
  let bar = document.getElementById(BAR_ID)
  if (!bar) {
    bar = document.createElement('div')
    bar.id = BAR_ID
    document.body.appendChild(bar)
  }
  return bar
}

/** 固定バーの内容を更新する */
export function updateBar(content: BarContent): void {
  const bar = getOrCreateBar()
  // 子要素をすべて消して作り直す
  bar.innerHTML = ''
  bar.className = BAR_ID

  if (content.status === 'empty') {
    bar.style.display = 'none'
    return
  }

  bar.style.display = ''

  if (content.status === 'loading') {
    bar.classList.add(`${BAR_ID}--loading`)
    bar.textContent = `${content.placeName}  動画情報読み込み中…`
    return
  }

  if (content.status === 'error') {
    bar.classList.add(`${BAR_ID}--error`)
    bar.textContent = `⚠️ ${content.message}`
    return
  }

  // status === 'ready'
  const nameEl = document.createElement('span')
  nameEl.className = `${BAR_ID}__name`
  nameEl.textContent = content.placeName
  bar.appendChild(nameEl)

  if (content.shortsTotal > 0) {
    bar.appendChild(makeButton(
      `▶ Shorts (${content.shortsTotal}件)`,
      `${BAR_ID}__btn ${BAR_ID}__btn--shorts`,
      content.onClickShorts,
    ))
  }
  if (content.videosTotal > 0) {
    bar.appendChild(makeButton(
      `▶ 動画 (${content.videosTotal}件)`,
      `${BAR_ID}__btn ${BAR_ID}__btn--videos`,
      content.onClickVideos,
    ))
  }
}

/** 固定バーを非表示にする */
export function hideBar(): void {
  const bar = document.getElementById(BAR_ID)
  if (bar) bar.style.display = 'none'
}

function makeButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = className
  btn.type = 'button'
  btn.textContent = label
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return btn
}
