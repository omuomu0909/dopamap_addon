import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const output = 'test/.youtubeParser.test.js'
await build({ entryPoints: ['src/api/youtubeParser.ts'], bundle: true, format: 'esm', platform: 'node', outfile: output })
const { parseShortsFromHtml } = await import(`../${output}`)

function html(items) {
  return `<script>var ytInitialData = ${JSON.stringify({ contents: { items } })};</script>`
}
const renderer = (id, width, height, title) => ({ videoRenderer: {
  videoId: id, title: { simpleText: title },
  thumbnail: { thumbnails: [{ width, height }] },
} })

test('縦長サムネイルだけを抽出する', () => {
  const clips = parseShortsFromHtml(html([
    renderer('vertical', 360, 640, '縦動画'),
    renderer('horizontal', 640, 360, '横動画'),
  ]))
  assert.deepEqual(clips.map((clip) => clip.videoId), ['vertical'])
})

test('壊れたHTMLと重複動画で例外を投げない', () => {
  assert.deepEqual(parseShortsFromHtml('<html>bot challenge</html>'), [])
  const clips = parseShortsFromHtml(html([renderer('same', 360, 640, 'A'), renderer('same', 360, 640, 'A')]))
  assert.equal(clips.length, 1)
})

test('サムネイル寸法がない検索結果でも動画を返す', () => {
  const item = { videoRenderer: { videoId: 'unknown-size', title: { simpleText: '店舗動画' } } }
  assert.deepEqual(parseShortsFromHtml(html([item])).map((clip) => clip.videoId), ['unknown-size'])
})