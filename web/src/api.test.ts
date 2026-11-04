import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, parseApiError } from './api';
import { createSessionStore, type KeyValueStorage } from './session';

function memoryStorage() {
  const map = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { storage, map };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const { storage, map } = memoryStorage();
  let clock = 1_000_000;
  const session = createSessionStore({ storage, now: () => clock });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => responder(String(input), init ?? {}));
  const api = createApi({ session, fetch: fetchMock as unknown as typeof fetch });
  return {
    api,
    session,
    fetchMock,
    map,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const ME = { clientId: 'cl_ops', tenantId: 'tenant-1', role: 'operator' };

describe('login', () => {
  it('keeps the token in session storage and never sends the secret anywhere but the token endpoint', async () => {
    const { api, session, fetchMock, map } = setup((url) => {
      if (url === '/oauth/token') return json(200, { access_token: 'tok-123', token_type: 'Bearer', expires_in: 900, role: 'operator' });
      return json(200, ME);
    });

    await api.login('cl_ops', 'cs_super_secret');

    expect(session.current.value?.token).toBe('tok-123');
    expect(session.current.value?.clientId).toBe('cl_ops');
    expect(session.current.value?.tenantId).toBe('tenant-1');
    const stored = [...map.values()].join('');
    expect(stored).toContain('tok-123');
    expect(stored).not.toContain('cs_super_secret');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe('/oauth/token');
    expect(JSON.parse(String(tokenInit.body))).toEqual({ grant_type: 'client_credentials', client_id: 'cl_ops', client_secret: 'cs_super_secret' });
    expect((tokenInit.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('reports a rejected login as invalid_client and starts no session', async () => {
    const { api, session } = setup(() => json(401, { error: 'invalid_client', error_description: 'Client authentication failed.' }));

    const attempt = api.login('cl_ops', 'wrong');

    await expect(attempt).rejects.toMatchObject({ status: 401, code: 'invalid_client', message: 'Client authentication failed.' });
    expect(session.current.value).toBeNull();
  });
});

describe('authenticated calls', () => {
  it('sends the bearer token', async () => {
    const { api, session, fetchMock } = setup(() => json(200, { days: 7, data: [] }));
    session.start({ token: 'tok-abc', expiresInSeconds: 900, role: 'viewer', clientId: 'cl_v' });

    await api.usage(7);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/admin/usage?days=7');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-abc');
  });

  it('ends the session and reports "expired" when the API answers 401', async () => {
    const { api, session } = setup(() =>
      json(401, { error: { type: 'authentication_error', code: 'invalid_token', message: 'Send a valid, unexpired bearer token from /oauth/token.' } }),
    );
    session.start({ token: 'tok-old', expiresInSeconds: 900, role: 'operator', clientId: 'cl_ops' });
    const ended = vi.fn();
    session.onEnd(ended);

    await expect(api.providers()).rejects.toMatchObject({ status: 401, code: 'invalid_token' });

    expect(session.current.value).toBeNull();
    expect(session.lastEnded.value).toBe('expired');
    expect(ended).toHaveBeenCalledWith('expired');
  });

  it('never sends an expired token: the call fails locally and the session ends', async () => {
    const { api, session, fetchMock, advance, map } = setup(() => json(200, {}));
    session.start({ token: 'tok-short', expiresInSeconds: 60, role: 'viewer', clientId: 'cl_v' });

    advance(61_000);

    await expect(api.usage(1)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.current.value).toBeNull();
    expect(map.size).toBe(0);
  });

  it('shows a 403 message from the server and keeps the session', async () => {
    const message = 'Role "viewer" lacks permission "keys:write".';
    const { api, session } = setup(() => json(403, { error: { type: 'permission_error', code: 'forbidden', message } }));
    session.start({ token: 'tok-viewer', expiresInSeconds: 900, role: 'viewer', clientId: 'cl_v' });

    const error = await api.createKey().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toBe(message);
    expect(session.current.value).not.toBeNull();
  });

  it('reports an unreachable gateway as a network error', async () => {
    const { api, session } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    session.start({ token: 'tok', expiresInSeconds: 900, role: 'admin', clientId: 'cl_a' });

    await expect(api.me()).rejects.toMatchObject({ status: 0, code: 'network_error' });
    expect(session.current.value).not.toBeNull();
  });
});

describe('parseApiError', () => {
  it('reads the /admin error shape', () => {
    const error = parseApiError(403, { error: { type: 'permission_error', code: 'forbidden', message: 'Nope.' } });
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: 'Nope.' });
  });

  it('reads the OAuth error shape', () => {
    const error = parseApiError(400, { error: 'unsupported_grant_type', error_description: 'Only client_credentials is supported.' });
    expect(error).toMatchObject({ status: 400, code: 'unsupported_grant_type', message: 'Only client_credentials is supported.' });
  });

  it('falls back to a readable message for unknown bodies', () => {
    expect(parseApiError(500, '<html>').message).toBe('Request failed with status 500.');
    expect(parseApiError(404, null).message).toBe('Not found.');
  });
});
