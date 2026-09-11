/**
 * content/videoPlayer.ts
 * フローティング動画プレイヤー。
 * React を使わず純粋な DOM 操作で実装。
 * 現行 WebApp の VideoModal.tsx と同等の機能を持つ。
 */

export interface VideoClip {
  videoId: string
  title: string
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
  private idx: number = 0
  private pos = { top: 16, left: Math.max(0, window.innerWidth - 436) }
  private width = 420
  private isDragging = false
  private isResizing = false
  private dragStartX = 0
  private dragStartY = 0
  private dragStartTop = 0
  private dragStartLeft = 0
  private resizeStartX = 0
  private resizeStartWidth = 0

  constructor(videos: VideoClip[], restaurantName: string, panelEl?: Element) {
    const rect = panelEl?.getBoundingClientRect()
    if (rect) {
      this.pos.top = Math.max(12, rect.top)
      const rightCandidate = rect.right + 16
      const leftCandidate = rect.left - this.width - 16
      this.pos.left = rightCandidate + this.width <= window.innerWidth
        ? rightCandidate
        : leftCandidate >= 12
          ? leftCandidate
          : window.innerWidth - this.width - 12
      this.pos.left = Math.max(12, this.pos.left)
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

    const closeBtn = document.createElement('button')
    closeBtn.className = 'mapshort-player-close'
    closeBtn.type = 'button'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => this.destroy())

    handle.appendChild(titleBar)
    handle.appendChild(closeBtn)

    // iframe
    const iframe = document.createElement('iframe')
    iframe.title = 'YouTube Shorts player'
    iframe.setAttribute('frameborder', '0')
    iframe.allowFullscreen = true
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

    // リサイズハンドル
    const resizeHandle = document.createElement('div')
    resizeHandle.className = 'mapshort-player-resize'

    container.appendChild(inner)
    container.appendChild(infoEl)  // inner の下に並べる（オーバーレイではない）
    container.appendChild(resizeHandle)

    return { container, iframe, infoEl, navPrev, navNext, videoTitleEl, counterEl }
  }

  // ─────────────────────────────────────────────
  // 再生制御
  // ─────────────────────────────────────────────

  play(idx: number): void {
    if (idx < 0 || idx >= this.videos.length) return
    this.idx = idx
    const video = this.videos[idx]
    this.iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(video.videoId)}?autoplay=1&rel=0&playsinline=1`
    this.videoTitleEl.textContent = video.title
    this.counterEl.textContent = `${idx + 1} / ${this.videos.length}`
    this.navPrev.disabled = idx === 0
    this.navNext.disabled = idx === this.videos.length - 1
  }

  destroy(): void {
    this.container.remove()
  }

  // ─────────────────────────────────────────────
  // ドラッグ移動
  // ─────────────────────────────────────────────

  private setupDrag(): void {
    const handle = this.container.querySelector(
      '.mapshort-player-drag-handle',
    ) as HTMLElement

    handle.addEventListener('mousedown', (e: MouseEvent) => {
      // 閉じるボタンは除外
      if ((e.target as HTMLElement).closest('.mapshort-player-close')) return
      e.preventDefault()
      this.isDragging = true
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
    })

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false
        this.container.classList.remove('dragging')
      }
    })
  }

  // ─────────────────────────────────────────────
  // リサイズ（右端ドラッグ）
  // ─────────────────────────────────────────────

  private setupResize(): void {
    const resizeHandle = this.container.querySelector(
      '.mapshort-player-resize',
    ) as HTMLElement

    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      this.isResizing = true
      this.resizeStartX = e.clientX
      this.resizeStartWidth = this.width
    })

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isResizing) return
      const dx = e.clientX - this.resizeStartX
      this.width = Math.min(600, Math.max(240, this.resizeStartWidth + dx))
      this.container.style.width = `${this.width}px`
    })

    document.addEventListener('mouseup', () => {
      if (this.isResizing) {
        this.isResizing = false
      }
    })
  }
}
