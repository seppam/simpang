import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

const noKeys = { findActiveKey: async () => null };

// A throwaway build folder with the shape Vite produces, plus a file beside it that must never leak.
let base: string;
let dist: string;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'simpang-console-'));
  dist = join(base, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>console</title>');
  await writeFile(join(dist, 'assets', 'index-abc123.js'), 'console.log("ok");');
  await writeFile(join(dist, 'assets', 'index-abc123.css'), 'body { margin: 0; }');
  await writeFile(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(join(base, 'package.json'), '{"name":"secret-root"}');
  app = buildApp({ keyStore: noKeys, consoleDir: dist });
});

afterEach(async () => {
  await app.close();
  await rm(base, { recursive: true, force: true });
});

describe('operator console at /console', () => {
  it('serves index.html at /console and /console/, never cached', async () => {
    for (const url of ['/console', '/console/']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toContain('<title>console</title>');
    }
  });

  it('serves a hashed asset with its content type and long-lived caching', async () => {
    const res = await app.inject({ method: 'GET', url: '/console/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.body).toBe('console.log("ok");');
  });

  it('serves css and svg with their own content types', async () => {
    const css = await app.inject({ method: 'GET', url: '/console/assets/index-abc123.css' });
    expect(css.headers['content-type']).toContain('text/css');

    const svg = await app.inject({ method: 'GET', url: '/console/favicon.svg' });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
  });

  it('falls back to index.html for client-side routes', async () => {
    for (const url of ['/console/providers', '/console/keys', '/console/tenants/42']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('<title>console</title>');
    }
  });

  it('answers 404 for a missing asset instead of returning HTML', async () => {
    const res = await app.inject({ method: 'GET', url: '/console/assets/missing-999.js' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<title>console</title>');
  });

  it('does not leak files outside the build folder', async () => {
    const attacks = [
      '/console/../package.json',
      '/console/%2e%2e/package.json',
      '/console/..%2fpackage.json',
      '/console/%2e%2e%2fpackage.json',
      '/console/assets/../../package.json',
    ];
    for (const url of attacks) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('secret-root');
    }
  });

  it('is not registered when the build folder does not exist', async () => {
    const bare = buildApp({ keyStore: noKeys, consoleDir: join(base, 'not-built') });
    const res = await bare.inject({ method: 'GET', url: '/console' });
    expect(res.statusCode).toBe(404);
    await bare.close();
  });
});
