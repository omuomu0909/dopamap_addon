/**
 * content/videoPlayer.ts
 * フローティング動画プレイヤー。
 * React を使わず純粋な DOM 操作で実装。
 */

export interface VideoClip {
  videoId: string
  title: string
  /** true = 縦長 Shorts、false = 横長通常動画 */
  isShort: boolean
  /** 投稿者チャンネル名 */
  channelName?: string
}

export class VideoPlayer {
  private container: HTMLElement
  private iframe: HTMLIFrameElement
  private infoEl: HTMLElement
  private navPrev: HTMLButtonElement
  private navNext: HTMLButtonElement
  private videoTitleEl: HTMLElement
  private counterEl: HTMLElement

  private videos: VideoClip[]
  private idx: number = -1
  private pos = { top: 16, left: Math.max(0, window.innerWidth - 576) }
  private width = 420
  /** 縦動画のデフォルト幅（storage から上書き可能） */
  private widthPortrait  = 420
  /** 横動画のデフォルト幅（storage から上書き可能） */
  private widthLandscape = 960
  /** パネル左端の X 座標（幅変更時に left を追従させるため保存） */
  private snapLeft: number | null = null
  private isDragging = false
  private dragStartX = 0
  private dragStartY = 0
  private dragStartTop = 0
  private dragStartLeft = 0
  /** document イベントリスナーの一括解除用 */
  private listenerAc = new AbortController()

  /** 現在の位置・幅スナップショット（引き継ぎ用） */
  getState(): { top: number; left: number; width: number; snapLeft: number | null } {
    return { top: this.pos.top, left: this.pos.left, width: this.width, snapLeft: this.snapLeft }
  }

  /** 現在再生中の動画クリップ */
  currentClip(): VideoClip | null {
    return this.idx >= 0 ? (this.videos[this.idx] ?? null) : null
  }

  constructor(
    videos: VideoClip[],
    restaurantName: string,
    panelEl?: Element,
    inheritState?: { top: number; left: number; width: number; snapLeft: number | null },
    shortWidth?: number,
    landscapeWidth?: number,
  ) {
    if (shortWidth     != null) this.widthPortrait  = shortWidth
    if (landscapeWidth != null) this.widthLandscape = landscapeWidth
    if (inheritState) {
      // 既存プレイヤーの位置・幅を引き継ぐ
      this.pos.top   = inheritState.top
      this.pos.left  = inheritState.left
      this.width     = inheritState.width
      this.snapLeft  = inheritState.snapLeft
      // idx を 0 に設定しておくことで play(0) の orientationChanged 判定で
      // prevVideo = this.videos[0] = 再生しようとする動画自身になり、
      // 向き変化なしと判定されてサイズがリセットされなくなる
      this.idx = 0
    } else {
      const rect = panelEl?.getBoundingClientRect()
      if (rect) {
        // パネルのヘッダーと同じ高さ・パネル左端にぴったり隣接する位置
        this.snapLeft = rect.left   // 幅変更時も left を追従させるために保存
        this.pos.top = rect.top
        this.pos.left = Math.max(0, rect.left - this.width)
      }
    }
    this.videos = videos
    const { container, iframe, infoEl, navPrev, navNext, videoTitleEl, counterEl } =
      this.createDOM(restaurantName)
    this.container = container
    this.iframe = iframe
    this.infoEl = infoEl
    this.navPrev = navPrev
    this.navNext = navNext
    this.videoTitleEl = videoTitleEl
    this.counterEl = counterEl

    document.body.appendChild(this.container)
    this.setupDrag()
    this.setupResize()
    this.play(0)
  }

  // ─────────────────────────────────────────────
  // DOM 構築
  // ─────────────────────────────────────────────

  private createDOM(restaurantName: string): {
    container: HTMLElement
    iframe: HTMLIFrameElement
    infoEl: HTMLElement
    navPrev: HTMLButtonElement
    navNext: HTMLButtonElement
    videoTitleEl: HTMLElement
    counterEl: HTMLElement
  } {
    const container = document.createElement('div')
    container.className = 'mapshort-player'
    container.style.cssText = `top:${this.pos.top}px;left:${this.pos.left}px;width:${this.width}px;`

    // ドラッグハンドル
    const handle = document.createElement('div')
    handle.className = 'mapshort-player-drag-handle'

    const titleBar = document.createElement('span')
    titleBar.className = 'mapshort-player-title-bar'
    titleBar.textContent = restaurantName

    const wheelHint = document.createElement('span')
    wheelHint.className = 'mapshort-player-wheel-hint'
    wheelHint.textContent = '↕ スクロールで拡縮'

    const closeBtn = document.createElement('button')
    closeBtn.className = 'mapshort-player-close'
    closeBtn.type = 'button'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => this.destroy())

    handle.appendChild(titleBar)
    handle.appendChild(wheelHint)
    handle.appendChild(closeBtn)

    // iframe
    const iframe = document.createElement('iframe')
    iframe.title = 'YouTube player'
    iframe.setAttribute('frameborder', '0')
    iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope'
    iframe.setAttribute('allowtransparency', 'true')

    // inner（handle + iframe をまとめて overflow:hidden に）
    const inner = document.createElement('div')
    inner.className = 'mapshort-player-inner'
    inner.appendChild(handle)
    inner.appendChild(iframe)

    // ナビ・情報エリア（プレイヤー下部に黒背景で配置）
    const infoEl = document.createElement('div')
    infoEl.className = 'mapshort-player-info'

    const navPrev = document.createElement('button')
    navPrev.className = 'mapshort-player-nav-btn'
    navPrev.type = 'button'
    navPrev.textContent = '‹'
    navPrev.addEventListener('click', () => this.play(this.idx - 1))

    const navNext = document.createElement('button')
    navNext.className = 'mapshort-player-nav-btn'
    navNext.type = 'button'
    navNext.textContent = '›'
    navNext.addEventListener('click', () => this.play(this.idx + 1))

    const videoTitleEl = document.createElement('span')
    videoTitleEl.className = 'mapshort-player-video-title'

    const nav = document.createElement('div')
    nav.className = 'mapshort-player-nav'
    nav.appendChild(navPrev)
    nav.appendChild(videoTitleEl)
    nav.appendChild(navNext)

    const counterEl = document.createElement('div')
    counterEl.className = 'mapshort-player-counter'

    infoEl.appendChild(nav)
    infoEl.appendChild(counterEl)

    container.appendChild(inner)
    container.appendChild(infoEl)

    return { container, iframe, infoEl, navPrev, navNext, videoTitleEl, counterEl }
  }

  // ─────────────────────────────────────────────
  // 再生制御
  // ─────────────────────────────────────────────

  play(idx: number): void {
    if (idx < 0 || idx >= this.videos.length) return
    const prevVideo = this.idx >= 0 ? this.videos[this.idx] : null
    this.idx = idx
    const video = this.videos[idx]
    this.iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(video.videoId)}?autoplay=1&rel=0&playsinline=1`
    this.videoTitleEl.textContent = video.title
    this.counterEl.textContent = `${idx + 1} / ${this.videos.length}`
    this.navPrev.disabled = idx === 0
    this.navNext.disabled = idx === this.videos.length - 1

    // 縦長 / 横長で aspect-ratio を切り替え
    const inner = this.container.querySelector('.mapshort-player-inner') as HTMLElement | null
    if (inner) {
      inner.dataset.orientation = video.isShort ? 'portrait' : 'landscape'
    }

    // 向きが変わったときだけデフォルト幅にリセット。
    // 同じ向きのままなら現在の幅（ユーザーがリサイズした値）を維持する。
    const orientationChanged = !prevVideo || prevVideo.isShort !== video.isShort
    if (orientationChanged) {
      this.setWidth(video.isShort ? this.widthPortrait : this.widthLandscape)
    }
  }

  destroy(): void {
    this.listenerAc.abort()
    this.container.remove()
  }

  /** 幅を設定してコンテナに反映する。snapLeft が設定されている場合は left も追従する */
  private setWidth(w: number): void {
    this.width = Math.min(window.innerWidth, Math.max(240, w))
    this.container.style.width = `${this.width}px`
    if (this.snapLeft !== null) {
      this.pos.left = Math.max(0, this.snapLeft - this.width)
      this.container.style.left = `${this.pos.left}px`
    }
  }

  // ─────────────────────────────────────────────
  // ドラッグ移動
  // ─────────────────────────────────────────────

  private setupDrag(): void {
    const handle = this.container.querySelector(
      '.mapshort-player-drag-handle',
    ) as HTMLElement
    const { signal } = this.listenerAc

    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.mapshort-player-close')) return
      e.preventDefault()
      this.isDragging = true
      this.snapLeft = null  // 手動ドラッグ開始でスナップ追従を解除
      this.dragStartX = e.clientX
      this.dragStartY = e.clientY
      this.dragStartTop = this.pos.top
      this.dragStartLeft = this.pos.left
      this.container.classList.add('dragging')
    })

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDragging) return
      const dx = e.clientX - this.dragStartX
      const dy = e.clientY - this.dragStartY
      this.pos.top = Math.max(0, this.dragStartTop + dy)
      this.pos.left = Math.max(0, this.dragStartLeft + dx)
      this.container.style.top = `${this.pos.top}px`
      this.container.style.left = `${this.pos.left}px`
    }, { signal })

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false
        this.container.classList.remove('dragging')
      }
    }, { signal })
  }

  // ─────────────────────────────────────────────
  // ホイールスクロールでリサイズ
  // ─────────────────────────────────────────────

  private setupResize(): void {
    const { signal } = this.listenerAc
    const STEP = 30   // 1ノッチあたりのピクセル変化量

    this.container.addEventListener('wheel', (e: WheelEvent) => {
      // プレイヤー上でのスクロールはページスクロールをキャンセルして幅変更に使う
      e.preventDefault()
      e.stopPropagation()
      // deltaY > 0 = 下スクロール = 縮小、deltaY < 0 = 上スクロール = 拡大
      const delta = e.deltaY > 0 ? -STEP : STEP
      this.setWidth(this.width + delta)
    }, { signal, passive: false })
  }
}
