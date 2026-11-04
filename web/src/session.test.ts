import { describe, expect, it, vi } from 'vitest';
import { createSessionStore, roleAtLeast, type KeyValueStorage } from './session';

const KEY = 'simpang.console.session';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { storage, map };
}

describe('session store', () => {
  it('restores a live session from storage and drops an expired one', () => {
    const live = memoryStorage({ [KEY]: JSON.stringify({ token: 't', expiresAt: 2_000_000, role: 'viewer', clientId: 'c', tenantId: null }) });
    expect(createSessionStore({ storage: live.storage, now: () => 1_000_000 }).current.value?.token).toBe('t');

    const expired = memoryStorage({ [KEY]: JSON.stringify({ token: 't', expiresAt: 900_000, role: 'viewer' }) });
    const store = createSessionStore({ storage: expired.storage, now: () => 1_000_000 });
    expect(store.current.value).toBeNull();
    expect(expired.map.has(KEY)).toBe(false);
  });

  it('ignores malformed stored data', () => {
    const { storage, map } = memoryStorage({ [KEY]: '{not json' });
    expect(createSessionStore({ storage }).current.value).toBeNull();
    expect(map.has(KEY)).toBe(false);
  });

  it('notifies listeners once when the session ends, and clears storage', () => {
    const { storage, map } = memoryStorage();
    const store = createSessionStore({ storage, now: () => 0 });
    store.start({ token: 't', expiresInSeconds: 900, role: 'admin', clientId: 'c' });
    expect(map.has(KEY)).toBe(true);

    const listener = vi.fn();
    store.onEnd(listener);
    store.end('signed-out');
    store.end('signed-out');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('signed-out');
    expect(map.has(KEY)).toBe(false);
  });

  it('works in memory when storage is unavailable', () => {
    const store = createSessionStore({ storage: null, now: () => 0 });
    store.start({ token: 't', expiresInSeconds: 900, role: 'viewer', clientId: null });
    expect(store.activeToken()).toBe('t');
  });
});

describe('roleAtLeast', () => {
  it('orders viewer < operator < admin', () => {
    expect(roleAtLeast('viewer', 'operator')).toBe(false);
    expect(roleAtLeast('operator', 'operator')).toBe(true);
    expect(roleAtLeast('admin', 'operator')).toBe(true);
    expect(roleAtLeast(null, 'viewer')).toBe(false);
  });
});
