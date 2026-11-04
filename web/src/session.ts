import { shallowRef, type ShallowRef } from 'vue';

// Sign-in state for the console. The bearer token is kept in sessionStorage only (never
// localStorage, never the URL) and dropped when its expiry passes or the API rejects it.
// The client secret is never stored at all.

export type Role = 'admin' | 'operator' | 'viewer';

export type Session = {
  token: string;
  expiresAt: number; // epoch milliseconds
  role: Role;
  clientId: string | null;
  tenantId: string | null;
};

export type EndReason = 'expired' | 'signed-out';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type SessionStore = ReturnType<typeof createSessionStore>;

const STORAGE_KEY = 'simpang.console.session';
const ROLES: readonly Role[] = ['viewer', 'operator', 'admin'];
// Treat the token as expired slightly early, so a request never leaves with a token about to lapse.
const EXPIRY_SKEW_MS = 30_000;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// True when `role` is at least `minimum` (viewer < operator < admin). Client-side only:
// the server enforces every permission, this just hides navigation the user cannot use.
export function roleAtLeast(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false;
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum);
}

export function browserSessionStorage(): KeyValueStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Some privacy modes throw on access. The console then keeps the session in memory only.
    return null;
  }
}

export function createSessionStore(options: { storage: KeyValueStorage | null; now?: () => number }) {
  const { storage } = options;
  const now = options.now ?? (() => Date.now());
  const endListeners = new Set<(reason: EndReason) => void>();
  const state: ShallowRef<Session | null> = shallowRef(null);
  const lastEnded: ShallowRef<EndReason | null> = shallowRef(null);

  const isLive = (session: Session) => session.expiresAt - EXPIRY_SKEW_MS > now();

  function removeStored() {
    try {
      storage?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear if storage is unavailable.
    }
  }

  function writeStored(session: Session) {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Storage full or blocked: the session still works for this page load.
    }
  }

  function readStored(): Session | null {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad session');
      const s = parsed as Partial<Session>;
      if (typeof s.token !== 'string' || typeof s.expiresAt !== 'number' || !isRole(s.role)) throw new Error('bad session');
      return { token: s.token, expiresAt: s.expiresAt, role: s.role, clientId: s.clientId ?? null, tenantId: s.tenantId ?? null };
    } catch {
      removeStored();
      return null;
    }
  }

  // Restore a session from an earlier page load in this tab, if it is still live.
  const restored = readStored();
  if (restored && isLive(restored)) {
    state.value = restored;
  } else if (restored) {
    removeStored();
    lastEnded.value = 'expired';
  }

  // Ends the session when its expiry has passed. Returns whether a live session remains.
  function checkExpiry(): boolean {
    const current = state.value;
    if (current && !isLive(current)) end('expired');
    return state.value !== null;
  }

  function start(input: { token: string; expiresInSeconds: number; role: Role; clientId: string | null }) {
    const session: Session = {
      token: input.token,
      expiresAt: now() + input.expiresInSeconds * 1000,
      role: input.role,
      clientId: input.clientId,
      tenantId: null,
    };
    state.value = session;
    lastEnded.value = null;
    writeStored(session);
  }

  function update(patch: Partial<Pick<Session, 'clientId' | 'tenantId'>>) {
    if (!state.value) return;
    state.value = { ...state.value, ...patch };
    writeStored(state.value);
  }

  // The live token, or null. An expired session is ended here, so callers never send it.
  function activeToken(): string | null {
    return checkExpiry() ? state.value!.token : null;
  }

  function end(reason: EndReason) {
    if (!state.value) return;
    state.value = null;
    lastEnded.value = reason;
    removeStored();
    for (const listener of endListeners) listener(reason);
  }

  function onEnd(listener: (reason: EndReason) => void): () => void {
    endListeners.add(listener);
    return () => endListeners.delete(listener);
  }

  return {
    /** The signed-in session, reactive. Null when signed out. */
    current: state as Readonly<ShallowRef<Session | null>>,
    /** Why the last session ended, shown on the sign-in page. */
    lastEnded: lastEnded as Readonly<ShallowRef<EndReason | null>>,
    now,
    start,
    update,
    activeToken,
    checkExpiry,
    end,
    onEnd,
  };
}

// The console's single session. Tests build their own stores with fake storage instead.
export const consoleSession = createSessionStore({ storage: browserSessionStorage() });
