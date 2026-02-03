const LOGO_CACHE_KEY = 'yieldo_logo_cache'
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7 days

interface LogoCache {
  [key: string]: {
    url: string
    timestamp: number
  }
}

function getCache(): LogoCache {
  if (typeof window === 'undefined') return {}
  try {
    const cached = localStorage.getItem(LOGO_CACHE_KEY)
    if (!cached) return {}
    const data = JSON.parse(cached)
    const now = Date.now()
    const filtered: LogoCache = {}
    for (const [key, value] of Object.entries(data)) {
      if (now - (value as any).timestamp < CACHE_EXPIRY) {
        filtered[key] = value as any
      }
    }
    return filtered
  } catch {
    return {}
  }
}

function setCache(cache: LogoCache) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(cache))
  } catch {}
}

export function getCachedLogo(key: string): string | null {
  const cache = getCache()
  return cache[key]?.url || null
}

export function setCachedLogo(key: string, url: string) {
  const cache = getCache()
  cache[key] = { url, timestamp: Date.now() }
  setCache(cache)
}

export function getLogoUrl(key: string, fallbackUrl?: string): string {
  const cached = getCachedLogo(key)
  if (cached) return cached
  if (fallbackUrl) {
    setCachedLogo(key, fallbackUrl)
    return fallbackUrl
  }
  return ''
}

