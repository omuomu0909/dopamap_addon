# Chrome拡張版 mapshort 設計書

> 本家 Google Maps 上に「ショート動画ボタン」を注入し、  
> 選択した場所に紐づく YouTube Shorts をマップ上のフローティングプレイヤーで再生する Chrome 拡張。

---

## 1. コンセプトと目的

### 1.1 現行 Webアプリとの違い

| 観点 | Webアプリ (mapshort) | Chrome拡張 (本設計) |
|------|--------------------|--------------------|
| 地図 | Maps JavaScript API（独自埋め込み） | 本家 Google Maps (maps.google.com) をそのまま使う |
| Maps APIキー | 必要（Nearby Search, Place Details） | **不要**（本家の DOM から Place ID を読み取る） |
| 場所の選択 | 独自マーカーをクリック | Google Maps の InfoWindow に「▶ ショート動画」ボタンを追加 |
| 動画プレイヤー | VideoModal (position:fixed, ドラッグ可) | 同等のフローティングプレイヤーを content script で注入 |
| モバイル対応 | ✅ レスポンシブ | ❌ PC Chrome のみ |
| 配布 | URL を開くだけ | Chrome Web Store（または手動インストール） |
| APIコスト | Maps + YouTube の両方 | **YouTube API のみ** |

### 1.2 ユーザーフロー

```
Google Maps を開く
    ↓
マーカー or 場所名をクリック
    ↓
Google Maps の InfoWindow が開く
    ↓
InfoWindow 内に「▶ ショート動画」ボタンが注入される
    ↓
ボタンをクリック
    ↓
フローティングプレイヤーが Maps 上に表示され自動再生
    ↓
前後ナビ・閉じるボタン・ドラッグ移動
```

---

## 2. アーキテクチャ全体図

```
Chrome拡張
├── manifest.json              Chrome拡張の設定ファイル（MV3）
│
├── background/
│   └── service_worker.ts      インストール・設定管理・メッセージルーター
│
├── content/
│   ├── index.ts               maps.google.com に注入されるエントリーポイント
│   ├── observer.ts            InfoWindow の DOM 変化を監視し Place ID を抽出
│   ├── infoWindowInjector.ts  「▶ ショート動画」ボタンを InfoWindow に挿入
│   └── videoPlayer.ts         フローティング動画プレイヤー（DOM直接操作）
│
├── api/
│   ├── youtube.ts             YouTube Data API v3（現行Webアプリから移植）
│   └── cache.ts               localStorage キャッシュ（現行から移植）
│
├── popup/
│   ├── popup.html             拡張アイコンクリック時の設定画面
│   └── popup.ts               APIキー入力・有効/無効トグル
│
└── utils/
    ├── genre.ts               YouTube クエリ生成（現行から移植）
    └── placeId.ts             Google Maps DOM から Place ID を抽出するロジック
```

---

## 3. manifest.json (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "mapshort — 地図でショート動画",
  "version": "1.0.0",
  "description": "Google Maps上の飲食店に関連するYouTube Shortsをマップ上で再生します",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://www.google.com/maps/*",
    "https://maps.google.com/*",
    "https://www.googleapis.com/*"
  ],
  "background": {
    "service_worker": "background/service_worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": [
        "https://www.google.com/maps/*",
        "https://maps.google.com/*"
      ],
      "js": ["content/index.js"],
      "css": ["content/styles.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## 4. コンポーネント詳細設計

### 4.1 `content/observer.ts` — InfoWindow 監視

Google Maps は SPA のため、マーカークリック時に InfoWindow を動的に DOM 注入する。  
`MutationObserver` で InfoWindow の出現を検知し、Place ID を抽出する。

```typescript
// InfoWindow の特定方法
// Google Maps の InfoWindow は以下の構造を持つ:
//   div[jsaction*="mouseover:pane"]
//   └── div[data-place-id="ChIJ..."]  // Place ID が data 属性に入る
//       └── h2.fontHeadlineSmall      // 店名
//       └── button[data-value="Directions"] などのアクションボタン群

export class InfoWindowObserver {
  private observer: MutationObserver
  private onDetect: (placeId: string, name: string, el: Element) => void

  constructor(callback: typeof this.onDetect) {
    this.onDetect = callback
    this.observer = new MutationObserver(this.handleMutations.bind(this))
  }

  start() {
    this.observer.observe(document.body, { childList: true, subtree: true })
  }

  stop() {
    this.observer.disconnect()
  }

  private handleMutations(mutations: MutationRecord[]) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue
        const infoWindow = this.findInfoWindow(node)
        if (infoWindow) {
          const placeId = this.extractPlaceId(infoWindow)
          const name = this.extractName(infoWindow)
          if (placeId && name) {
            this.onDetect(placeId, name, infoWindow)
          }
        }
      }
    }
  }

  private findInfoWindow(root: Element): Element | null {
    // data-place-id 属性を持つ要素を探す
    if (root.hasAttribute('data-place-id')) return root
    return root.querySelector('[data-place-id]')
  }

  private extractPlaceId(el: Element): string | null {
    return el.getAttribute('data-place-id') ?? null
  }

  private extractName(el: Element): string | null {
    return (
      el.querySelector('h2.fontHeadlineSmall')?.textContent?.trim() ??
      el.querySelector('[data-attrid="title"]')?.textContent?.trim() ??
      null
    )
  }
}
```

> **⚠️ 注意**: Google Maps の DOM 構造は予告なく変更される可能性がある。  
> `data-place-id` の属性名や InfoWindow のセレクターは定期的なメンテナンスが必要。

### 4.2 `content/infoWindowInjector.ts` — ボタン注入

```typescript
// 注入するボタンの HTML
// InfoWindow 内のアクションボタン群（「ルート」「保存」「共有」など）の隣に追加する

export function injectShortsButton(
  infoWindowEl: Element,
  onClick: () => void,
): () => void {
  // すでに注入済みならスキップ
  if (infoWindowEl.querySelector('.mapshort-btn')) return () => {}

  const btn = document.createElement('button')
  btn.className = 'mapshort-btn'
  btn.innerHTML = `
    <span class="mapshort-btn-icon">▶</span>
    <span class="mapshort-btn-label">ショート動画</span>
  `
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })

  // アクションボタン行に挿入（「ルート」ボタンの隣）
  const actionBar = infoWindowEl.querySelector('[data-value="Directions"]')?.parentElement
  if (actionBar) {
    actionBar.appendChild(btn)
  } else {
    // フォールバック: InfoWindow の末尾に追加
    infoWindowEl.appendChild(btn)
  }

  // クリーンアップ関数を返す
  return () => btn.remove()
}
```

### 4.3 `content/videoPlayer.ts` — フローティングプレイヤー

現行 Webアプリの [`VideoModal`](src/components/VideoModal.tsx) の機能を  
React なしの純粋な DOM 操作で再実装する。

**機能要件（現行と同等）:**
- `position: fixed` でビューポート全体に浮かせる
- ドラッグで移動可能（ドラッグハンドル）
- 右端ドラッグでリサイズ可能（幅 180〜500px）
- YouTube iframe 埋め込みで自動再生
- 複数動画の前後ナビゲーション
- hover 時のみタイトル・ナビを表示
- iframe 上の pointer-events 制御（ドラッグ中はブロック）

```typescript
export class VideoPlayer {
  private container: HTMLElement
  private iframe: HTMLIFrameElement
  private videos: VideoClip[]
  private idx: number = 0
  private pos = { top: 16, left: window.innerWidth - 320 }
  private width = 300
  private isDragging = false

  constructor(videos: VideoClip[], restaurantName: string) {
    this.videos = videos
    this.container = this.createContainer(restaurantName)
    document.body.appendChild(this.container)
    this.setupDrag()
    this.setupResize()
    this.play(0)
  }

  private createContainer(name: string): HTMLElement {
    // ... DOM 構築（詳細は実装フェーズで）
  }

  play(idx: number) {
    this.idx = idx
    const video = this.videos[idx]
    this.iframe.src = `https://www.youtube.com/embed/${video.videoId}?autoplay=1&rel=0`
  }

  destroy() {
    this.container.remove()
  }
}
```

### 4.4 `api/youtube.ts` — 現行から移植

現行 Webアプリの [`src/api/youtube.ts`](src/api/youtube.ts) をほぼそのまま移植できる。  
変更点は1つのみ:

| 現行 | 拡張版 |
|------|--------|
| `import.meta.env.VITE_YOUTUBE_API_KEY` | `chrome.storage.sync.get('youtubeApiKey')` |

APIキーは popup から `chrome.storage.sync` に保存し、content script が取得する。

### 4.5 `api/cache.ts` — 現行からほぼそのまま移植

`localStorage` ベースのキャッシュはそのまま使える。  
TTL設定も現行と同じ（Places: 1h / YouTube: 24h）でよい。

ただし拡張版では **Places API を使わない**ため、  
`placesKey` / `youtubeKey` のうち `youtubeKey` のみ必要。

### 4.6 `popup/popup.ts` — 設定画面

```typescript
// 設定項目
interface ExtensionSettings {
  youtubeApiKey: string   // YouTube Data API v3 キー
  enabled: boolean        // 拡張の有効/無効
}

// popup で行うこと
// 1. APIキーの入力・保存（chrome.storage.sync）
// 2. 有効/無効トグル
// 3. キャッシュクリアボタン
// 4. 現在のAPIキーのクォータ使用状況の説明リンク
```

---

## 5. Place ID 取得戦略

Chrome拡張版では Google Maps API キーが不要なため、  
**本家 Google Maps の DOM から直接 Place ID を読み取る**。

### 5.1 取得方法（優先順位順）

| 優先度 | 方法 | 安定性 |
|--------|------|--------|
| 1 | `data-place-id` 属性 | 高（公式データ属性として存在） |
| 2 | URL パラメーター `?place_id=...` | 高（URL は比較的安定） |
| 3 | `window.APP_INITIALIZATION_STATE` などのグローバル変数 | 低（変更リスク高） |

### 5.2 フォールバック（Place ID が取れなかった場合）

Place ID の代わりに**店名 + 現在地**でYouTube検索を行う。  
検索精度は下がるが、動画を表示する機能自体は維持できる。

```typescript
// Place ID あり: placeId をキャッシュキーにして検索クエリに使う
// Place ID なし: 店名 + "近く" でYouTube検索（精度は低下）
const query = placeId
  ? buildYouTubeQuery(name, areaName)
  : `${name} グルメ ショート`
```

---

## 6. データフロー

```
[Google Maps でマーカークリック]
        ↓
[MutationObserver が InfoWindow を検知]
        ↓
[Place ID と店名を DOM から抽出]
        ↓
[InfoWindow に「▶ ショート動画」ボタンを注入]
        ↓
[ユーザーがボタンをクリック]
        ↓
[chrome.storage.sync から YouTube API キーを取得]
        ↓
[localStorage キャッシュを確認]
  ├─ HIT → キャッシュから VideoClip[] を返す
  └─ MISS → YouTube Data API v3 に search.list + videos.list を投げる
              └─ レスポンスを localStorage に保存（TTL: 24h）
        ↓
[VideoPlayer を DOM に注入して自動再生]
```

---

## 7. ファイル構成（ビルド後）

```
dist/
├── manifest.json
├── background/
│   └── service_worker.js
├── content/
│   ├── index.js            // バンドル済み content script
│   └── styles.css          // 注入する CSS
├── popup/
│   ├── popup.html
│   └── popup.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 8. ビルド設定

### 8.1 技術スタック

| 用途 | 技術 |
|------|------|
| 言語 | TypeScript |
| バンドラー | Vite（現行と同じ）+ `vite-plugin-web-extension` |
| UI | React **なし**（content script は純粋な DOM 操作） |
| Popup UI | React（軽量なので OK）または 素の HTML+TS |

> content script で React を使うと Shadow DOM 管理が複雑になるため、  
> content script は DOM 操作のみで実装する。

### 8.2 現行コードの再利用範囲

| ファイル | 再利用 | 変更点 |
|---------|--------|--------|
| `src/api/youtube.ts` | ✅ ほぼそのまま | `import.meta.env` → `chrome.storage.sync` |
| `src/api/cache.ts` | ✅ そのまま | 変更なし |
| `src/utils/genre.ts` | ✅ そのまま | 変更なし |
| `src/types.ts` (`VideoClip`) | ✅ そのまま | 変更なし |
| `src/components/VideoModal.tsx` | ❌ React → DOM | 同機能を DOM 操作で再実装 |
| `src/api/places.ts` | ❌ 不要 | 本家 Maps の DOM から取得するため |
| `src/api/placeDetails.ts` | ❌ 不要 | 本家 Maps に詳細情報が表示されているため |

---

## 9. CSS 設計（注入スタイル）

content script が注入するスタイルは、Google Maps の既存スタイルと衝突しないよう  
**プレフィックス `.mapshort-`** を全クラスに付与する。

```css
/* content/styles.css */

/* ショート動画ボタン */
.mapshort-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  background: #d87950;       /* 現行 Webアプリのブランドカラーを踏襲 */
  color: white;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.mapshort-btn:hover {
  background: #c06840;
}

/* フローティング動画プレイヤー */
.mapshort-player {
  position: fixed;
  z-index: 9999;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  background: #000;
  user-select: none;
}

.mapshort-player-drag-handle {
  height: 28px;
  background: rgba(0,0,0,0.7);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
}

.mapshort-player-drag-handle:active {
  cursor: grabbing;
}

.mapshort-player iframe {
  width: 100%;
  aspect-ratio: 9/16;
  border: none;
  display: block;
}

/* ナビ・タイトル（hover 時のみ表示） */
.mapshort-player-info {
  opacity: 0;
  transition: opacity 0.2s;
  padding: 8px;
  background: linear-gradient(transparent, rgba(0,0,0,0.8));
  color: white;
  font-size: 12px;
}

.mapshort-player:hover .mapshort-player-info {
  opacity: 1;
}

/* リサイズハンドル（右端） */
.mapshort-player-resize {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
}
```

---

## 10. セキュリティ・プライバシー考慮事項

| 項目 | 対応 |
|------|------|
| YouTube API キー | `chrome.storage.sync` に保存（localStorage より安全） |
| CSP (Content Security Policy) | MV3 の制約上、`eval` 不使用・外部スクリプト読み込み不可 |
| host_permissions | google.com/maps と googleapis.com のみに限定 |
| DOM アクセス | content script のスコープ内のみ。ページの JS へのアクセスなし |
| ユーザーデータ | 収集しない。APIキーとキャッシュのみローカル保存 |

---

## 11. Chrome Web Store 審査への備え

| チェック項目 | 対応方針 |
|------------|---------|
| 単一目的の原則 | 「Google Maps 上でショート動画を表示する」1機能に集中 |
| 最小権限の原則 | `storage` + `activeTab` + 必要な host_permissions のみ |
| APIキーの扱い | ユーザーが自分のキーを入力（拡張にキーをバンドルしない） |
| プライバシーポリシー | 公開時に用意が必要（データ収集なしと明記） |

---

## 12. 開発ロードマップ

### Phase 1 — MVP（最小動作版）

- [ ] プロジェクトセットアップ（Vite + `vite-plugin-web-extension`）
- [ ] `MutationObserver` で InfoWindow の出現検知
- [ ] Place ID 抽出（`data-place-id` 属性）
- [ ] 「▶ ショート動画」ボタンの注入
- [ ] YouTube API 呼び出し（`api/youtube.ts` 移植）
- [ ] シンプルなフローティングプレイヤー（ドラッグなし）
- [ ] Popup で APIキーの設定

### Phase 2 — 現行 Webアプリと同等の UX

- [ ] プレイヤーのドラッグ移動
- [ ] プレイヤーの右端リサイズ
- [ ] 複数動画の前後ナビゲーション
- [ ] hover 時のみ UI 表示（iframe の pointer-events 制御）
- [ ] localStorage キャッシュの導入

### Phase 3 — 拡張固有の機能

- [ ] 検索結果リスト上の店舗にも対応（InfoWindow なしのケース）
- [ ] ピン留め（動画を見た店舗を記録）
- [ ] 「お気に入り」機能（`chrome.storage.sync` で同期）
- [ ] DOM 構造変更時の自動フォールバック通知

---

## 13. リスクと対策

| リスク | 深刻度 | 対策 |
|--------|--------|------|
| Google Maps の DOM 構造変更で InfoWindow 検知が壊れる | 高 | セレクターを複数フォールバックで実装。バージョン管理で変更を追いやすくする |
| YouTube API クォータ超過（10,000 units/日） | 中 | 現行と同じ localStorage キャッシュ（TTL: 24h）で抑制 |
| Chrome Web Store の審査落ち | 中 | 単一目的・最小権限を守る。プライバシーポリシーを用意 |
| `data-place-id` が将来的に削除される | 中 | URL パラメーターや店名からのフォールバックを実装 |
| YouTube iframe の CSP ブロック | 低 | MV3 の `content_security_policy` で `frame-src https://www.youtube.com` を許可 |
