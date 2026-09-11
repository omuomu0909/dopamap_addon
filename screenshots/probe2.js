// Place ID を URL から取得
var url = location.href;
var placeMatch = url.match(/!1s([^!]+)/);
var placeIdFromUrl = placeMatch ? placeMatch[1] : null;

// ルートボタンの親をさかのぼって "ルート・保存・共有" が揃っている行を探す
var routeBtn = document.querySelector('button[aria-label*="\u30eb\u30fc\u30c8"]');
var actionBar = null;
var el = routeBtn;
for (var i = 0; i < 5 && el; i++) {
  el = el.parentElement;
  if (el && el.children.length >= 3) {
    actionBar = el;
    break;
  }
}

// h1 タイトル
var titleEl = document.querySelector('h1');

JSON.stringify({
  placeIdFromUrl: placeIdFromUrl,
  titleText: titleEl ? titleEl.textContent.trim().slice(0, 40) : null,
  actionBarTag: actionBar ? actionBar.tagName : null,
  actionBarClass: actionBar ? actionBar.className.slice(0, 80) : null,
  actionBarChildCount: actionBar ? actionBar.children.length : 0,
  actionBarChildren: actionBar ? Array.from(actionBar.children).map(function(c){ return (c.getAttribute('aria-label') || c.tagName).slice(0,20); }) : []
});
