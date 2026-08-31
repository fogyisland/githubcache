import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadProviderSource,
  resolveFileRoots,
  ProviderSourceError,
} from '@/lib/ingestion/providers/source';
import type { ProviderConfig } from '@/lib/ingestion/providers/schema';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm19-src-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function writeFixture(name: string, body: unknown): Promise<string> {
  const filePath = path.join(tempDir, name);
  await fs.writeFile(filePath, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return filePath;
}

describe('resolveFileRoots', () => {
  it('returns absolute paths from PROVIDER_FILE_ROOTS', () => {
    process.env.PROVIDER_FILE_ROOTS = '/a,/b, /c';
    expect(resolveFileRoots()).toEqual([
      path.resolve('/a'),
      path.resolve('/b'),
      path.resolve('/c'),
    ]);
  });

  it('returns empty array when unset', () => {
    delete process.env.PROVIDER_FILE_ROOTS;
    expect(resolveFileRoots()).toEqual([]);
  });
});

describe('loadProviderSource — file kind', () => {
  it('reads, parses, and applies itemsPath', async () => {
    const filePath = await writeFixture('nodes.json', {
      custom_nodes: [{ id: 'a' }, { id: 'b' }],
    });
    const config: ProviderConfig = {
      kind: 'file',
      path: filePath,
      itemsPath: '$.custom_nodes',
      urlField: 'id',
    };
    const items = await loadProviderSource(config, {
      fileRoots: [tempDir],
    });
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('rejects paths outside the file roots allowlist', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm19-out-'));
    try {
      const filePath = await writeFixture('x.json', { a: 1 });
      const config: ProviderConfig = {
        kind: 'file',
        path: filePath,
        itemsPath: '$',
        urlField: 'a',
      };
      await expect(
        loadProviderSource(config, { fileRoots: [outsideDir] }),
      ).rejects.toMatchObject({
        name: 'ProviderSourceError',
        code: 'FILE_OUT_OF_ROOTS',
      });
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects when file roots are empty', async () => {
    const filePath = await writeFixture('x.json', { a: 1 });
    const config: ProviderConfig = {
      kind: 'file',
      path: filePath,
      itemsPath: '$',
      urlField: 'a',
    };
    await expect(
      loadProviderSource(config, { fileRoots: [] }),
    ).rejects.toMatchObject({ code: 'FILE_OUT_OF_ROOTS' });
  });

  it('throws FILE_NOT_FOUND on ENOENT', async () => {
    const config: ProviderConfig = {
      kind: 'file',
      path: path.join(tempDir, 'missing.json'),
      itemsPath: '$',
      urlField: 'a',
    };
    await expect(
      loadProviderSource(config, { fileRoots: [tempDir] }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  it('throws JSON_PARSE on invalid JSON', async () => {
    const filePath = await writeFixture('bad.json', '{not: "valid" json}');
    const config: ProviderConfig = {
      kind: 'file',
      path: filePath,
      itemsPath: '$',
      urlField: 'a',
    };
    await expect(
      loadProviderSource(config, { fileRoots: [tempDir] }),
    ).rejects.toMatchObject({ code: 'JSON_PARSE' });
  });

  it('throws BAD_ITEMSPATH when itemsPath does not yield array', async () => {
    const filePath = await writeFixture('obj.json', { foo: 'bar' });
    const config: ProviderConfig = {
      kind: 'file',
      path: filePath,
      itemsPath: '$.foo',
      urlField: 'x',
    };
    await expect(
      loadProviderSource(config, { fileRoots: [tempDir] }),
    ).rejects.toMatchObject({ code: 'BAD_ITEMSPATH' });
  });

  it('accepts an empty array result', async () => {
    const filePath = await writeFixture('empty.json', { nodes: [] });
    const config: ProviderConfig = {
      kind: 'file',
      path: filePath,
      itemsPath: '$.nodes',
      urlField: 'x',
    };
    const items = await loadProviderSource(config, {
      fileRoots: [tempDir],
    });
    expect(items).toEqual([]);
  });
});

describe('loadProviderSource — http kind', () => {
  it('fetches, parses, and applies itemsPath', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const config: ProviderConfig = {
      kind: 'http',
      url: 'https://example.com/list.json',
      itemsPath: '$.data',
      urlField: 'id',
    };
    const items = await loadProviderSource(config);
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('passes custom headers', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const config: ProviderConfig = {
      kind: 'http',
      url: 'https://example.com/list.json',
      itemsPath: '$',
      urlField: 'x',
      headers: { 'X-Auth': 'token', Accept: 'application/json' },
    };
    await loadProviderSource(config);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/list.json',
      expect.objectContaining({
        method: 'GET',
        headers: { 'X-Auth': 'token', Accept: 'application/json' },
      }),
    );
  });

  it('passes AbortSignal when provided', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const config: ProviderConfig = {
      kind: 'http',
      url: 'https://example.com/list.json',
      itemsPath: '$',
      urlField: 'x',
    };
    const controller = new AbortController();
    await loadProviderSource(config, { signal: controller.signal });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/list.json',
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('throws HTTP_ERROR on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
    const config: ProviderConfig = {
      kind: 'http',
      url: 'https://example.com/missing.json',
      itemsPath: '$',
      urlField: 'x',
    };
    await expect(loadProviderSource(config)).rejects.toMatchObject({
      name: 'ProviderSourceError',
      code: 'HTTP_ERROR',
    });
  });

  it('throws JSON_PARSE on invalid JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json{', { status: 200 })),
    );
    const config: ProviderConfig = {
      kind: 'http',
      url: 'https://example.com/list.json',
      itemsPath: '$',
      urlField: 'x',
    };
    await expect(loadProviderSource(config)).rejects.toMatchObject({
      code: 'JSON_PARSE',
    });
  });

  it('throws BAD_ITEMSPATH when itemsPath yields non-array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ x: 'y' }), { status: 200 })),
    );
    const config: ProviderConfig = {
      kind: 'http',
      url: 'https://example.com/list.json',
      itemsPath: '$.x',
      urlField: 'y',
    };
    await expect(loadProviderSource(config)).rejects.toMatchObject({
      code: 'BAD_ITEMSPATH',
    });
  });
});

describe('ProviderSourceError', () => {
  it('exposes name + code', () => {
    const e = new ProviderSourceError('msg', 'FILE_NOT_FOUND');
    expect(e.name).toBe('ProviderSourceError');
    expect(e.code).toBe('FILE_NOT_FOUND');
    expect(e.message).toBe('msg');
  });
});