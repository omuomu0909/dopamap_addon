/**
 * content/observer.ts
 * Google Maps の場所詳細パネルを検知し、パネルが変わるたびにコールバックを呼ぶ。
 *
 * 責務:
 *   - 詳細パネル要素を特定して返す
 *   - 店舗が変わった（aria-label が変化した）ことを1回だけ通知する
 *   - DOM の過剰監視によるループ・多重通知を起こさない
 *
 * 検知パターン:
 *   A) 詳細パネルが DOM に新規追加される（検索バーから開いたとき）
 *   B) 詳細パネルの aria-label が変化する（マップのピンをクリックしたとき）
 *   C) ページロード時点で既にパネルが存在する（直URL アクセス）
 *
 * タイミング問題への対処:
 *   Google Maps は SPA のため、role="main" のコンテナが追加されてから
 *   h1（店舗名）が描画されるまで非同期の間がある。
 *   そのため role="main" 要素が追加されたら、その内部を別の MutationObserver で
 *   監視し、h1 が追加されたタイミングで attachPanel する。
 */

export type PanelDetectCallback = (
  name: string,
  panelEl: Element,
) => void

export class InfoWindowObserver {
  private bodyObserver: MutationObserver
  private labelObserver: MutationObserver | null = null
  /** role="main" 候補の中身が揃うのを待つ一時 Observer */
  private candidateObserver: MutationObserver | null = null
  private onDetect: PanelDetectCallback
  /** 現在追跡中の詳細パネル要素 */
  private currentPanel: Element | null = null
  /** 直前に通知した識別キー（重複通知防止） */
  private lastKey: string | null = null

  constructor(callback: PanelDetectCallback) {
    this.onDetect = callback
    this.bodyObserver = new MutationObserver(this.handleBodyMutations.bind(this))
  }

  start(): void {
    // パターン C: 既存パネルをまず確認
    const existing = this.findDetailPanel(document.body)
    if (existing) {
      console.log('[mapshort] パターンC: 既存パネルを発見', existing)
      this.attachPanel(existing)
    } else {
      console.log('[mapshort] パターンA: bodyObserver 開始（パネル待機中）')
      // パターン A: パネル追加を待つ
      this.bodyObserver.observe(document.body, { childList: true, subtree: true })
    }
  }

  stop(): void {
    this.bodyObserver.disconnect()
    this.labelObserver?.disconnect()
    this.candidateObserver?.disconnect()
    this.labelObserver = null
    this.candidateObserver = null
    this.currentPanel = null
    this.lastKey = null
  }

  // ------------------------------------------------------------------ //
  // パネルを掴んで aria-label 監視に切り替える
  // ------------------------------------------------------------------ //

  private attachPanel(panel: Element): void {
    // 既に同じパネルを監視中なら何もしない
    if (this.currentPanel === panel) return
    this.currentPanel = panel
    console.log('[mapshort] attachPanel:', panel.getAttribute('aria-label'))

    // 候補監視・bodyObserver は不要になったので停止
    this.candidateObserver?.disconnect()
    this.candidateObserver = null
    // bodyObserver は店舗変更で新パネルが差し替わるケースに備えて継続する
    // （labelObserver で aria-label 変化を検知できるが、パネル要素自体が
    //   入れ替わる場合は bodyObserver が必要）

    // パターン B: aria-label の変化のみ監視（店舗切り替えを検知）
    // aria-label の値を直接名前として使う（h1 はまだ古い内容の可能性があるため信頼しない）
    this.labelObserver?.disconnect()
    this.labelObserver = new MutationObserver(() => {
      const name = this.extractNameFromLabel(panel)
      if (name) this.notify(panel, name)
    })
    this.labelObserver.observe(panel, {
      attributes: true,
      attributeFilter: ['aria-label'],
    })

    // 初回通知: aria-label を優先、なければ h1
    const name = this.extractNameFromLabel(panel) || this.extractName(panel)
    if (name) this.notify(panel, name)
  }

  // ------------------------------------------------------------------ //
  // パターン A: body の addedNodes からパネル（または候補）を探す
  // ------------------------------------------------------------------ //

  private handleBodyMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue

        // ① 既に h1 まで揃っている完成済みパネル
        const panel = this.findDetailPanel(node)
        if (panel) {
          console.log('[mapshort] パターンA: 完成済みパネルを発見')
          this.attachPanel(panel)
          return
        }

        // ② role="main" はあるが h1 がまだない → 内部の追加を待つ
        const candidate = this.findMainCandidate(node)
        if (candidate && !this.candidateObserver) {
          console.log('[mapshort] パターンA: role=main 候補を発見、h1 待機中')
          this.watchCandidate(candidate)
        }
      }
    }
  }

  /**
   * node 自身または子孫に role="main" かつ aria-label がある要素を返す。
   * h1 の存在は問わない（まだ描画中の可能性があるため）。
   */
  private findMainCandidate(node: Element): Element | null {
    if (node.getAttribute('role') === 'main' && (node.getAttribute('aria-label') ?? '').trim()) {
      return node
    }
    const found = Array.from(node.querySelectorAll('[role="main"]')).find(
      el => (el.getAttribute('aria-label') ?? '').trim() !== '',
    )
    return found ?? null
  }

  /**
   * role="main" の候補要素の内部を監視し、h1 が追加されたら attachPanel する。
   */
  private watchCandidate(candidate: Element): void {
    this.candidateObserver?.disconnect()
    this.candidateObserver = new MutationObserver(() => {
      if (this.isDetailPanel(candidate)) {
        console.log('[mapshort] パターンA: 候補内に h1 を確認、attachPanel')
        this.candidateObserver?.disconnect()
        this.candidateObserver = null
        this.attachPanel(candidate)
      }
    })
    this.candidateObserver.observe(candidate, { childList: true, subtree: true })
  }

  // ------------------------------------------------------------------ //
  // 通知（重複スキップ）
  // ------------------------------------------------------------------ //

  private notify(panel: Element, name: string): void {
    if (name === this.lastKey) {
      console.log('[mapshort] notify スキップ（重複）:', name)
      return
    }
    this.lastKey = name
    console.log('[mapshort] notify:', name)
    this.onDetect(name, panel)
  }

  // ------------------------------------------------------------------ //
  // DOM ユーティリティ
  // ------------------------------------------------------------------ //

  /**
   * 場所詳細パネルを返す。
   * Google Maps では role="main" が同時に2つ存在する:
   *   1. 検索結果リストパネル … aria-label なし
   *   2. 店舗詳細パネル       … aria-label = 店舗名  ← これを返す
   */
  private findDetailPanel(root: Element): Element | null {
    if (this.isDetailPanel(root)) return root
    const candidates = root.querySelectorAll('[role="main"]')
    for (const el of candidates) {
      if (this.isDetailPanel(el)) return el
    }
    return null
  }

  private isDetailPanel(el: Element): boolean {
    if (el.getAttribute('role') !== 'main') return false
    const label = (el.getAttribute('aria-label') ?? '').trim()
    if (!label) return false
    // h1 が存在すれば詳細パネルとみなす
    return !!el.querySelector('h1')
  }

  /**
   * aria-label から接尾語を除去して純粋な店舗名を返す。
   * Google Maps の aria-label に付く可能性がある接尾語:
   *   - " - Google マップ"
   *   - "（クチコミ N 件）" 等の括弧
   *   - "の情報"
   */
  private extractNameFromLabel(el: Element): string | null {
    const raw = (el.getAttribute('aria-label') ?? '').trim()
    if (!raw) return null
    return raw
      // " - Google マップ" などのダッシュ以降を除去
      .replace(/\s*[-－–—]\s*(Google\s*マップ|Google Maps).*/i, '')
      // "（クチコミ...）" などの括弧部分を除去
      .replace(/[（(][^）)]*[）)]/g, '')
      // "の情報" などの末尾接尾語を除去
      .replace(/の情報$/, '')
      .trim() || null
  }

  private extractName(el: Element): string | null {
    return (
      el.querySelector('h1')?.textContent?.trim() ||
      el.querySelector('h2.fontHeadlineSmall')?.textContent?.trim() ||
      null
    )
  }
}
