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

/** 投稿者フィルタ設定 */
export interface ChannelFilter {
  text: string
  mode: 'partial' | 'exact'
}

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

/** プレイヤーの位置・サイズ記憶型 */
type PlayerState = { top: number; left: number; width: number; snapLeft: number | null }

export class SidePanel {
  private el: HTMLElement
  private isOpen = true
  private theme: 'dark' | 'light' = 'light'
  private currentPlayer: VideoPlayer | null = null
  private currentPlaceEl: HTMLElement
  private listEl: HTMLElement
  private scanBtn: HTMLButtonElement
  private keywordInput: HTMLInputElement
  private channelInput: HTMLInputElement
  private channelModeBtn: HTMLButtonElement
  private presetEl: HTMLElement
  private onScanRequest: (() => void) | null = null
  private onScanStop: (() => void) | null = null
  private onKeywordChange: ((kw: string) => void) | null = null
  private onChannelFilterChange: ((f: ChannelFilter) => void) | null = null
  private channelFilter: ChannelFilter = { text: '', mode: 'partial' }
  private domWatcher: MutationObserver
  /** ショート動画のデフォルト幅 */
  private shortWidth     = 420
  /** 通常動画のデフォルト幅 */
  private landscapeWidth = 960
  /** リスト再生ボタンで動画を起動した直後は destroyPlayer を無視する */
  private keepPlayerUntil = 0
  /** 縦動画（Shorts）の最終位置・サイズ */
  private lastStatePortrait: PlayerState | null = null
  /** 横動画の最終位置・サイズ */
  private lastStateLandscape: PlayerState | null = null

  constructor() {
    this.el = this.createPanelDOM()
    this.currentPlaceEl = this.el.querySelector('.msp-current-place')!
    this.listEl = this.el.querySelector('.msp-list')!
    this.scanBtn = this.el.querySelector('.msp-scan-btn')!
    this.keywordInput = this.el.querySelector('.msp-keyword-input')!
    this.channelInput = this.el.querySelector('.msp-channel-input')!
    this.channelModeBtn = this.el.querySelector('.msp-channel-mode-btn')!
    this.presetEl = this.el.querySelector('.msp-channel-presets')!
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

  /** パネルの root 要素を返す（MutationObserver の除外用） */
  getElement(): HTMLElement { return this.el }

  /** ショート動画のデフォルト幅を設定する（storage からの初期化用） */
  setShortWidth(w: number): void {
    this.shortWidth = w
  }

  /** 通常動画のデフォルト幅を設定する（storage からの初期化用） */
  setLandscapeWidth(w: number): void {
    this.landscapeWidth = w
  }

  /** テーマを適用する（storage からの初期化用） */
  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme
    this.applyTheme()
  }

  /** スキャンボタンのコールバックを登録する */
  onScan(start: () => void, stop: () => void): void {
    this.onScanRequest = start
    this.onScanStop = stop
  }

  /** 追加キーワード変更時のコールバックを登録する */
  onExtraKeyword(cb: (kw: string) => void): void {
    this.onKeywordChange = cb
  }

  /** 現在の追加キーワードを返す */
  getExtraKeyword(): string {
    return this.keywordInput.value.trim()
  }

  /** 追加キーワード入力欄の値を外部からセットする */
  setExtraKeyword(kw: string): void {
    this.keywordInput.value = kw
  }

  /** 投稿者フィルタ変更コールバックを登録する */
  onChannelFilter(cb: (f: ChannelFilter) => void): void {
    this.onChannelFilterChange = cb
  }

  /** 現在の投稿者フィルタを返す */
  getChannelFilter(): ChannelFilter {
    return { ...this.channelFilter }
  }

  /** 投稿者フィルタを外部からセットする */
  setChannelFilter(f: ChannelFilter): void {
    this.channelFilter = { ...f }
    this.channelInput.value = f.text
    this.channelModeBtn.textContent = f.mode === 'exact' ? '完全一致' : '部分一致'
    this.channelModeBtn.dataset.mode = f.mode
    this.updatePresetActive()
  }

  /** 投稿者プリセットを設定してタグUIを描画する */
  setChannelPresets(presets: string[]): void {
    this.presetEl.innerHTML = ''
    for (const name of presets) {
      const tag = document.createElement('button')
      tag.type = 'button'
      tag.className = 'msp-preset-tag'
      tag.textContent = name
      tag.dataset.preset = name
      tag.addEventListener('click', () => {
        // 同じプリセットを再クリックしたらフィルタ解除
        const isSame = this.channelFilter.text === name
        const next: ChannelFilter = isSame
          ? { text: '', mode: this.channelFilter.mode }
          : { text: name, mode: this.channelFilter.mode }
        this.channelFilter = next
        this.channelInput.value = next.text
        this.updatePresetActive()
        this.onChannelFilterChange?.(this.getChannelFilter())
      })
      this.presetEl.appendChild(tag)
    }
    this.updatePresetActive()
  }

  private updatePresetActive(): void {
    const current = this.channelFilter.text.trim()
    this.presetEl.querySelectorAll<HTMLButtonElement>('.msp-preset-tag').forEach(tag => {
      tag.classList.toggle('msp-preset-tag--active', tag.dataset.preset === current)
    })
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

  /** 現在パネルに表示されているリストアイテムの名前セットを返す */
  getListItemNames(): Set<string> {
    const names = new Set<string>()
    this.listEl.querySelectorAll<HTMLElement>('.msp-list-row[data-name]').forEach(row => {
      if (row.dataset.name) names.add(row.dataset.name)
    })
    return names
  }

  /**
   * 新しい検索結果向けにリストをリセットする。
   * keepNames に含まれる名前の行は残し、それ以外は削除する。
   * keepNames が空なら全消しして「スキャン中…」ヒントを表示する。
   */
  resetListForNewSearch(keepNames: Set<string>): void {
    // keepNames にない行を削除
    this.listEl.querySelectorAll<HTMLElement>('.msp-list-row[data-name]').forEach(row => {
      if (!keepNames.has(row.dataset.name ?? '')) row.remove()
    })
    // 残った行がなければヒントを表示
    if (this.listEl.querySelectorAll('.msp-list-row').length === 0) {
      this.listEl.innerHTML = '<p class="msp-hint">スキャン中…</p>'
    }
    this.scanBtn.textContent = '▶ リストをスキャン'
    this.scanBtn.disabled = false
  }

  /** リストをクリアして「スキャン待機」状態にする */
  clearList(): void {
    this.listEl.innerHTML = '<p class="msp-hint">スキャン中…</p>'
    this.scanBtn.textContent = '▶ リストをスキャン'
    this.scanBtn.disabled = false
  }

  /** リストアイテムを追加する（同名行が既にあれば更新する） */
  addListItem(item: ListItem): void {
    // 既存行があれば更新して終わり（検索し直しで引き継いだ行の重複追加を防ぐ）
    const existing = this.listEl.querySelector(`[data-name="${CSS.escape(item.name)}"]`) as HTMLElement | null
    if (existing) {
      this.renderListRow(existing, item)
      return
    }
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
    // リスト再生ボタン直後の猶予期間中は破壊しない
    if (Date.now() < this.keepPlayerUntil) return
    // 閉じる前に位置・サイズを向き別に保存
    if (this.currentPlayer) {
      const clip = this.currentPlayer.currentClip()
      const state = this.currentPlayer.getState()
      if (clip?.isShort) this.lastStatePortrait  = state
      else               this.lastStateLandscape = state
    }
    this.currentPlayer?.destroy()
    this.currentPlayer = null
  }

  // ─────────────────────────────────────────────
  // プライベートメソッド
  // ─────────────────────────────────────────────

  private playVideos(clips: VideoClip[], name: string, fromList = false): void {
    const firstClip = clips[0]

    // 引き継ぎ優先度:
    //   1. 現在プレイヤーが生きていて同じ向き → 現プレイヤーの状態
    //   2. 閉じた後でも向き別の最終状態が保存されていればそれを使う
    //   3. どちらもなければ初期位置（panelEl 基準）
    let inheritState: PlayerState | undefined
    if (this.currentPlayer && firstClip &&
        this.currentPlayer.currentClip()?.isShort === firstClip.isShort) {
      inheritState = this.currentPlayer.getState()
    } else if (firstClip) {
      inheritState = (firstClip.isShort ? this.lastStatePortrait : this.lastStateLandscape) ?? undefined
    }

    this.currentPlayer?.destroy()
    this.currentPlayer = new VideoPlayer(clips, name, this.el, inheritState, this.shortWidth, this.landscapeWidth)

    // リスト再生ボタン経由の場合、直後の destroyPlayer 呼び出しを 1 秒間ガード
    if (fromList) this.keepPlayerUntil = Date.now() + 1000
  }

  private renderListRow(row: HTMLElement, item: ListItem): void {
    row.innerHTML = ''

    const nameEl = document.createElement('span')
    nameEl.className = 'msp-list-row__name'
    if (item.mapRow) {
      nameEl.classList.add('msp-list-row__name--clickable')
      nameEl.title = 'Google Maps で開く'
      nameEl.addEventListener('click', () => openMapRow(item.mapRow!))
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
        () => { if (item.mapRow) openMapRow(item.mapRow); this.playVideos(item.shorts!, item.name, true) },
      ))
    }
    if ((item.videosTotal ?? 0) > 0) {
      btns.appendChild(this.makeVideoBtn(
        `▶V${item.videosTotal}`,
        'msp-badge-btn msp-badge-btn--videos',
        () => { if (item.mapRow) openMapRow(item.mapRow); this.playVideos(item.videos!, item.name, true) },
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

  private applyTheme(): void {
    if (this.theme === 'light') {
      this.el.classList.add('msp--light')
    } else {
      this.el.classList.remove('msp--light')
    }
  }

  private createPanelDOM(): HTMLElement {
    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.className = 'msp msp--open'

    panel.innerHTML = `
      <div class="msp-header">
        <span class="msp-header__title">🎬 dopamap</span>
        <button class="msp-header__toggle" type="button" title="パネルを折りたたむ">◀</button>
      </div>

      <div class="msp-body">
        <section class="msp-section">
          <div class="msp-section__label">追加キーワード</div>
          <input
            class="msp-keyword-input"
            type="text"
            placeholder="例: 食べログ  vlog  行ってみた"
            autocomplete="off"
            spellcheck="false"
          />
        </section>

        <section class="msp-section">
          <div class="msp-section__label">投稿者フィルタ</div>
          <div class="msp-channel-row">
            <input
              class="msp-channel-input"
              type="text"
              placeholder="チャンネル名"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="msp-channel-mode-btn" type="button" data-mode="partial">部分一致</button>
          </div>
          <div class="msp-channel-presets"></div>
        </section>

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
            <p class="msp-hint">Maps の検索結果が表示されると自動でスキャンします</p>
          </div>
        </section>
      </div>
    `

    // トグルボタン
    const toggle = panel.querySelector('.msp-header__toggle') as HTMLButtonElement
    toggle.addEventListener('click', () => this.toggleOpen())

    // 追加キーワード入力欄: Enter または blur で確定通知
    const kwInput = panel.querySelector('.msp-keyword-input') as HTMLInputElement
    const fireKeyword = () => this.onKeywordChange?.(kwInput.value.trim())
    kwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fireKeyword() })
    kwInput.addEventListener('blur', fireKeyword)

    // 投稿者フィルタ: Enter / blur で確定、モードボタンでトグル
    const chInput = panel.querySelector('.msp-channel-input') as HTMLInputElement
    const chModeBtn = panel.querySelector('.msp-channel-mode-btn') as HTMLButtonElement
    const fireChannel = () => {
      this.channelFilter.text = chInput.value.trim()
      this.onChannelFilterChange?.(this.getChannelFilter())
    }
    chInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fireChannel() })
    chInput.addEventListener('blur', fireChannel)
    chModeBtn.addEventListener('click', () => {
      const next: ChannelFilter['mode'] = this.channelFilter.mode === 'partial' ? 'exact' : 'partial'
      this.channelFilter.mode = next
      chModeBtn.textContent = next === 'exact' ? '完全一致' : '部分一致'
      chModeBtn.dataset.mode = next
      if (this.channelFilter.text) this.onChannelFilterChange?.(this.getChannelFilter())
    })

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

/**
 * Google Maps のリスト行（.Nv2PK）をクリックして詳細パネルを開く。
 *
 * Maps のリスト行内には店舗詳細へのリンク要素（a.hfpxzc）があり、
 * それをクリックすることで詳細パネルが開く。
 * 見つからない場合は行全体をクリックしてフォールバックする。
 */
function openMapRow(mapRow: HTMLElement): void {
  // a.hfpxzc: Google Maps の店舗詳細リンク（検索結果リスト行内）
  const link = mapRow.querySelector<HTMLElement>('a.hfpxzc') ?? mapRow
  link.click()
}
