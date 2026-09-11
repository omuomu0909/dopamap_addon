// src/api/youtubeParser.ts
function parseShortsFromHtml(html, maxResults = 10) {
  const data = extractInitialData(html);
  if (!data) return [];
  const verticalClips = [];
  const fallbackClips = [];
  walk(data, (value) => {
    if (!isRecord(value) || !isRecord(value.videoRenderer)) return;
    const renderer = value.videoRenderer;
    const videoId = typeof renderer.videoId === "string" ? renderer.videoId : "";
    if (!videoId) return;
    const clip = { videoId, title: extractText(renderer.title) || "YouTube Shorts" };
    if (fallbackClips.some((item) => item.videoId === videoId)) return;
    fallbackClips.push(clip);
    if (isVerticalThumbnail(renderer) || isShortsEndpoint(renderer)) verticalClips.push(clip);
  });
  return (verticalClips.length > 0 ? verticalClips : fallbackClips).slice(0, maxResults);
}
function isShortsEndpoint(renderer) {
  const endpoint = isRecord(renderer.navigationEndpoint) ? renderer.navigationEndpoint : null;
  const metadata = endpoint && isRecord(endpoint.commandMetadata) ? endpoint.commandMetadata : null;
  const web = metadata && isRecord(metadata.webCommandMetadata) ? metadata.webCommandMetadata : null;
  return typeof web?.url === "string" && web.url.includes("/shorts/");
}
function extractInitialData(html) {
  for (const marker of ["var ytInitialData = ", "ytInitialData = "]) {
    const start = html.indexOf(marker);
    const jsonStart = start < 0 ? -1 : html.indexOf("{", start + marker.length);
    if (jsonStart < 0) continue;
    const json = readObject(html, jsonStart);
    if (json) {
      try {
        return JSON.parse(json);
      } catch {
      }
    }
  }
  return null;
}
function readObject(text, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
function isVerticalThumbnail(renderer) {
  const thumbnails = isRecord(renderer.thumbnail) ? renderer.thumbnail.thumbnails : null;
  if (!Array.isArray(thumbnails)) return false;
  return thumbnails.some((thumbnail) => {
    if (!isRecord(thumbnail)) return false;
    const width = Number(thumbnail.width);
    const height = Number(thumbnail.height);
    return width > 0 && height >= width * 1.25;
  });
}
function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
  else if (isRecord(value)) Object.values(value).forEach((item) => walk(item, visit));
}
function extractText(value) {
  if (!isRecord(value)) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map(extractText).join("");
  return typeof value.text === "string" ? value.text : "";
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export {
  parseShortsFromHtml
};
