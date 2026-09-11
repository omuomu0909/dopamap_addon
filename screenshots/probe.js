var b = document.querySelector('button[aria-label*="\u30eb\u30fc\u30c8"]');
var p = b ? b.parentElement : null;
var result = {
  found: !!b,
  parentTag: p ? p.tagName : null,
  parentClass: p ? p.className.slice(0, 80) : null,
  siblingCount: p ? p.children.length : 0,
  siblingAriaLabels: p ? Array.from(p.children).map(function(c){ return c.getAttribute('aria-label'); }) : [],
  dataPlaceId: document.querySelector('[data-place-id]') ? document.querySelector('[data-place-id]').getAttribute('data-place-id') : 'NOT FOUND',
  jsactions: Array.from(document.querySelectorAll('[jsaction]')).slice(0,5).map(function(e){ return e.getAttribute('jsaction'); })
};
JSON.stringify(result);
