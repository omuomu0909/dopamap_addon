/**
 * content/sidePanel.ts
 * mapshort サイドパネル。
 *
 * Google Maps の右端に固定配置される独立UIコンテナ。
 * Maps 本体の DOM には一切触れない。
 *
 * 表示内容:
 *   - 現在の店舗セクション: observer から受け取った店舗の動画ボタン
 *   - リストスキャンセクション: Maps のリスト行から取得した店舗一覧 + 動画件数
 */

import type { VideoClip } from './videoPlayer'
import { VideoPlayer } from './videoPlayer'

export type CurrentPlaceState =
  | { status: 'idle' }
  | { status: 'loading'; name: string; query?: string }
  | { status: 'ready'; name: string; shorts: VideoClip[]; videos: VideoClip[]; shortsTotal: number; videosTotal: number; query?: string }
  | { status: 'error'; name: string; message: string; query?: string }
  | { status: 'empty'; name: string; query?: string }

export interface ListItem {
  name: string
  status: 'scanning' | 'ready' | 'empty'
  shorts?: VideoClip[]
  videos?: VideoClip[]
  shortsTotal?: number
  videosTotal?: number
  /** Maps リスト行の DOM 要素。クリックで Maps 側の詳細パネルを開く */
  mapRow?: HTMLElement
}

const PANEL_ID = 'mapshort-side-panel'

export class SidePanel {
  private el: HTMLElement
  private isOpen = true
  private currentPlayer: VideoPlayer | null = null
  private currentPlaceEl: HTMLElement
  private listEl: HTMLElement
  private scanBtn: HTMLButtonElement
  private onScanRequest: (() => void) | null = null
  private onScanStop: (() => void) | null = null
  private domWatcher: MutationObserver

  constructor() {
    this.el = this.createPanelDOM()
    this.currentPlaceEl = this.el.querySelector('.msp-current-place')!
    this.listEl = this.el.querySelector('.msp-list')!
    this.scanBtn = this.el.querySelector('.msp-scan-btn')!
    this.mount()
    // Maps のナビゲーションで body から外れたら即 re-mount する
    // subtree: true で body 自体の置き換えも検知
    this.domWatcher = new MutationObserver(() => {
      if (!document.body || !document.body.contains(this.el)) {
        this.mount()
      }
    })
    this.domWatcher.observe(document.documentElement, { childList: true, subtree: true })
  }

  private mount(): void {
    // body が存在するまでポーリング
    if (!document.body) {
      setTimeout(() => this.mount(), 50)
      return
    }
    // 既に body に入っていれば何もしない
    if (document.body.contains(this.el)) return
    document.body.appendChild(this.el)
  }

  // ─────────────────────────────────────────────
  // パブリック API
  // ─────────────────────────────────────────────

  /** スキャンボタンのコールバックを登録する */
  onScan(start: () => void, stop: () => void): void {
    this.onScanRequest = start
    this.onScanStop = stop
  }

  /** 現在の店舗セクションを更新する */
  setCurrentPlace(state: CurrentPlaceState): void {
    const el = this.currentPlaceEl
    el.innerHTML = ''

    if (state.status === 'idle') {
      el.innerHTML = '<p class="msp-hint">店舗をクリックすると動画を検索します</p>'
      return
    }

    const nameEl = document.createElement('div')
    nameEl.className = 'msp-place-name'
    nameEl.textContent = state.name
    el.appendChild(nameEl)

    if (state.status === 'loading') {
      const msg = document.createElement('div')
      msg.className = 'msp-status-text'
      msg.textContent = '動画を検索中…'
      el.appendChild(msg)
      if (state.query) el.appendChild(this.makeQueryEl(state.query))
      return
    }

    if (state.status === 'error') {
      const msg = document.createElement('div')
      msg.className = 'msp-status-text msp-status-text--error'
      msg.textContent = `⚠ ${state.message}`
      el.appendChild(msg)
      if (state.query) el.appendChild(this.makeQueryEl(state.query))
      return
    }

    if (state.status === 'empty') {
      const msg = document.createElement('div')
      msg.className = 'msp-status-text'
      msg.textContent = '動画が見つかりませんでした'
      el.appendChild(msg)
      if (state.query) el.appendChild(this.makeQueryEl(state.query))
      return
    }

    // ready
    const btns = document.createElement('div')
    btns.className = 'msp-btn-row'
    if (state.shortsTotal > 0) {
      btns.appendChild(this.makeVideoBtn(
        `▶ Shorts  ${state.shortsTotal}件`,
        'msp-btn msp-btn--shorts',
        () => this.playVideos(state.shorts, state.name),
      ))
    }
    if (state.videosTotal > 0) {
      btns.appendChild(this.makeVideoBtn(
        `▶ 動画  ${state.videosTotal}件`,
        'msp-btn msp-btn--videos',
        () => this.playVideos(state.videos, state.name),
      ))
    }
    el.appendChild(btns)
    if (state.query) el.appendChild(this.makeQueryEl(state.query))
  }

  /** リストをクリアして「スキャン待機」状態にする */
  clearList(): void {
    this.listEl.innerHTML = '<p class="msp-hint">「リストをスキャン」を押すと\nMaps の一覧から動画を検索します</p>'
    this.scanBtn.textContent = '▶ リストをスキャン'
    this.scanBtn.disabled = false
  }

  /** リストアイテムを追加する */
  addListItem(item: ListItem): void {
    // ヒントテキストがあれば消す
    this.listEl.querySelector('.msp-hint')?.remove()

    const row = document.createElement('div')
    row.className = 'msp-list-row'
    row.dataset.name = item.name
    this.renderListRow(row, item)
    this.listEl.appendChild(row)
  }

  /** 既存のリストアイテムを更新する */
  updateListItem(item: ListItem): void {
    const row = this.listEl.querySelector(`[data-name="${CSS.escape(item.name)}"]`) as HTMLElement | null
    if (!row) return
    this.renderListRow(row, item)
  }

  /** スキャン中状態にする */
  setScanningState(scanning: boolean): void {
    this.scanBtn.textContent = scanning ? '■ スキャン停止' : '▶ リストをスキャン'
    this.scanBtn.disabled = false
  }

  destroyPlayer(): void {
    this.currentPlayer?.destroy()
    this.currentPlayer = null
  }

  // ─────────────────────────────────────────────
  // プライベートメソッド
  // ─────────────────────────────────────────────

  private playVideos(clips: VideoClip[], name: string): void {
    this.currentPlayer?.destroy()
    this.currentPlayer = new VideoPlayer(clips, name)
  }

  private renderListRow(row: HTMLElement, item: ListItem): void {
    row.innerHTML = ''

    const nameEl = document.createElement('span')
    nameEl.className = 'msp-list-row__name'
    if (item.mapRow) {
      nameEl.classList.add('msp-list-row__name--clickable')
      nameEl.title = 'Google Maps で開く'
      nameEl.addEventListener('click', () => item.mapRow!.click())
    }
    nameEl.textContent = item.name
    row.appendChild(nameEl)

    if (item.status === 'scanning') {
      const dot = document.createElement('span')
      dot.className = 'msp-list-row__scanning'
      dot.textContent = '…'
      row.appendChild(dot)
      return
    }

    if (item.status === 'empty') return  // 動画なしの行は名前だけ

    // ready
    const btns = document.createElement('span')
    btns.className = 'msp-list-row__btns'
    if ((item.shortsTotal ?? 0) > 0) {
      btns.appendChild(this.makeVideoBtn(
        `▶S${item.shortsTotal}`,
        'msp-badge-btn msp-badge-btn--shorts',
        () => this.playVideos(item.shorts!, item.name),
      ))
    }
    if ((item.videosTotal ?? 0) > 0) {
      btns.appendChild(this.makeVideoBtn(
        `▶V${item.videosTotal}`,
        'msp-badge-btn msp-badge-btn--videos',
        () => this.playVideos(item.videos!, item.name),
      ))
    }
    row.appendChild(btns)
  }

  private makeQueryEl(query: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'msp-query'
    el.textContent = `🔍 ${query}`
    return el
  }

  private makeVideoBtn(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = className
    btn.textContent = label
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
    return btn
  }

  private createPanelDOM(): HTMLElement {
    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.className = 'msp msp--open'

    panel.innerHTML = `
      <div class="msp-header">
        <span class="msp-header__title">🎬 mapshort</span>
        <button class="msp-header__toggle" type="button" title="パネルを折りたたむ">◀</button>
      </div>

      <div class="msp-body">
        <section class="msp-section">
          <div class="msp-section__label">現在の店舗</div>
          <div class="msp-current-place">
            <p class="msp-hint">店舗をクリックすると動画を検索します</p>
          </div>
        </section>

        <section class="msp-section">
          <div class="msp-section__label">リストスキャン</div>
          <button class="msp-scan-btn" type="button">▶ リストをスキャン</button>
          <div class="msp-list">
            <p class="msp-hint">「リストをスキャン」を押すと\nMaps の一覧から動画を検索します</p>
          </div>
        </section>
      </div>
    `

    // トグルボタン
    const toggle = panel.querySelector('.msp-header__toggle') as HTMLButtonElement
    toggle.addEventListener('click', () => this.toggleOpen())

    // スキャンボタン
    const scanBtn = panel.querySelector('.msp-scan-btn') as HTMLButtonElement
    scanBtn.addEventListener('click', () => {
      if (scanBtn.textContent?.startsWith('■')) {
        this.onScanStop?.()
        this.setScanningState(false)
      } else {
        this.onScanRequest?.()
      }
    })

    return panel
  }

  private toggleOpen(): void {
    this.isOpen = !this.isOpen
    const toggle = this.el.querySelector('.msp-header__toggle') as HTMLButtonElement
    if (this.isOpen) {
      this.el.classList.add('msp--open')
      toggle.textContent = '◀'
      toggle.title = 'パネルを折りたたむ'
    } else {
      this.el.classList.remove('msp--open')
      toggle.textContent = '▶'
      toggle.title = 'パネルを開く'
    }
  }
}
