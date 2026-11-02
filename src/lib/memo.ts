import "server-only";

/**
 * A small in-process cache for data that is read on almost every request but rarely changes
 * (the signed-in user, stages, settings). Each database round trip to Supabase costs a full
 * network round trip, so skipping them matters more than anything else for response time.
 *
 * Values expire after `ttlMs`; code that changes the underlying data calls `invalidate()` so the
 * change is visible immediately in this process. With several server instances, other instances
 * pick it up when their copy expires.
 */
export function memo<K, V>(ttlMs: number, load: (key: K) => Promise<V>) {
  const entries = new Map<K, { value: Promise<V>; expires: number }>();
  const get = (key: K): Promise<V> => {
    const hit = entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = load(key);
    entries.set(key, { value, expires: Date.now() + ttlMs });
    // Never cache a failure.
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    return value;
  };
  get.invalidate = (key?: K) => (key === undefined ? entries.clear() : entries.delete(key));
  return get;
}
