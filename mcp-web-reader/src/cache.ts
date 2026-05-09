type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  createdAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

export function getCache<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }

  return entry.value as T;
}

export function setCache<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, {
    value,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs
  });
}

export function hasCache(key: string): boolean {
  const entry = store.get(key);
  if (!entry) return false;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return false;
  }

  return true;
}

export function clearCache(): number {
  const count = store.size;
  store.clear();
  return count;
}

export function cacheSize(): number {
  return store.size;
}

export function cacheKeys(): string[] {
  return Array.from(store.keys());
}

export function cacheStats() {
  const now = Date.now();

  return {
    size: store.size,
    entries: Array.from(store.entries()).map(([key, entry]) => ({
      key,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      ttlRemainingMs: Math.max(0, entry.expiresAt - now)
    }))
  };
}