/**
 * api/cache.ts
 * localStorage ベースのシンプルなキャッシュ。
 * 現行 WebApp の src/api/cache.ts から移植（Places キャッシュは削除）。
 */

const TTL_MS = {
  youtube: 24 * 60 * 60 * 1000, // 24 時間
} as const

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

function makeKey(prefix: string, id: string): string {
  return `mapshort:${prefix}:${id}`
}

export function getCache<T>(prefix: string, id: string): T | null {
  try {
    const raw = localStorage.getItem(makeKey(prefix, id))
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(makeKey(prefix, id))
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

export function setCache<T>(prefix: string, id: string, data: T): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + TTL_MS.youtube,
    }
    localStorage.setItem(makeKey(prefix, id), JSON.stringify(entry))
  } catch {
    // localStorage が使えない場合は何もしない
  }
}

/** mapshort のキャッシュをすべてクリアする */
export function clearAllCache(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('mapshort:')) keys.push(key)
  }
  keys.forEach((k) => localStorage.removeItem(k))
}
