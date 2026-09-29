import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import BetterSQLite from 'better-sqlite3';
import { openDatabase, insertImage } from '../src/services/database';
import { removeFile, sha256File } from '../src/services/deduplication';
import { processImage } from '../src/services/imageProcessor';
import { assertStorageCapacity, resolveMediaPath } from '../src/services/storage';
import { getCrawlLimits, runImageCrawler } from '../src/crawlers/imageCrawler';
import type { ImageSource } from '../src/config/sources';
import { env } from '../src/config/env';
import { buildServer } from '../src/api/server';
import { ScrapyCloudService } from '../src/services/scrapyCloud';

const source: ImageSource = {
  name: 'Permitted Test Fixtures', type: 'image', url: 'https://fixtures.example.test/images',
  enabled: true, maxItems: 10, license: 'CC0 test fixtures'
};

function candidates(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://fixtures.example.test/${i}.png`, title: `fixture-${i}`, sourceUrl: source.url,
    description: `description-${i}`, author: `author-${i}`, attribution: `attribution-${i}`,
    license: 'CC0 1.0', category: 'Fixture category', tags: ['tag-one', 'rare bird']
  }));
}

async function fixturePng(index: number): Promise<Buffer> {
  return sharp({ create: { width: 18, height: 18, channels: 3, background: { r: index * 39 % 255, g: 90, b: 170 } } }).png().toBuffer();
}

function memoryDb() { return openDatabase(':memory:'); }

test('test mode is clamped to three items/downloads, one page and two outbound requests', () => {
  assert.deepEqual(getCrawlLimits('test'), { maxItems: 3, maxDownloads: 3, maxPages: 1, maxRequests: 2 });
  assert.throws(() => getCrawlLimits('test', 0), /positive integer/);
  assert.throws(() => getCrawlLimits('test', -1), /positive integer/);
});

test('database initialization migrates existing image tables with Wikimedia metadata columns', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imgnest-migration-'));
  const databasePath = path.join(dir, 'legacy.db');
  const legacy = new BetterSQLite(databasePath);
  legacy.exec(`CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL UNIQUE, filepath TEXT NOT NULL,
    title TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, source_url TEXT NOT NULL,
    license TEXT NOT NULL DEFAULT 'Unknown', width INTEGER NOT NULL, height INTEGER NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/webp', file_size INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);
  legacy.close();

  const migrated = openDatabase(databasePath);
  const columns = new Set((migrated.prepare('PRAGMA table_info(images)').all() as Array<{ name: string }>).map((column) => column.name));
  for (const column of ['source_page_url', 'description', 'author', 'attribution', 'tags']) assert.ok(columns.has(column));
  migrated.close();
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('Scrapy Cloud client launches a bounded job, polls it, and caps returned items', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/api/run.json')) {
      return new Response(JSON.stringify({ status: 'ok', jobid: '123/4/5' }), { status: 200 });
    }
    if (url.includes('/api/jobs/list.json')) {
      return new Response(JSON.stringify({ jobs: [{ id: '123/4/5', state: 'finished', close_reason: 'finished', errors_count: 0 }] }), { status: 200 });
    }
    if (url.includes('storage.zyte.com/items/')) {
      return new Response(JSON.stringify(candidates(50)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('unexpected URL', { status: 404 });
  }) as typeof fetch;
  try {
    const cloud = new ScrapyCloudService({
      apiKey: 'test-cloud-secret', projectId: '123', spider: 'imgnest_images', timeoutMs: 1000, pollIntervalMs: 1
    });
    const result = await cloud.crawl({ sourceUrl: source.url, mode: 'test', maxItems: 3, maxPages: 1, maxRequests: 2, historicalBeforeYear: 1990 });
    assert.equal(result.length, 3);
    assert.equal(result[0].url, 'https://fixtures.example.test/0.png');
    const launch = calls[0];
    assert.equal(launch.init?.method, 'POST');
    const form = new URLSearchParams(String(launch.init?.body));
    assert.equal(form.get('max_items'), '3');
    assert.equal(form.get('mode'), 'test');
    assert.equal(form.get('historical_before_year'), '1990');
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.get('authorization'), `Basic ${Buffer.from('test-cloud-secret:').toString('base64')}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('crawler saves no more than three images even when the page contains thousands', async () => {
  const db = memoryDb();
  const before = new Set(fs.existsSync(env.imageStoragePath) ? fs.readdirSync(env.imageStoragePath) : []);
  let downloaded = 0;
  const result = await runImageCrawler({
    mode: 'test', source, db,
    discovery: { crawl: async () => candidates(10_000) },
    downloader: async (url) => {
      downloaded += 1;
      const filepath = path.join(env.tempStoragePath, `test-${Date.now()}-${downloaded}.download`);
      await fs.promises.mkdir(env.tempStoragePath, { recursive: true });
      await fs.promises.writeFile(filepath, await fixturePng(Number(new URL(url).pathname.slice(1, -4))));
      return { filepath, contentType: 'image/png', size: (await fs.promises.stat(filepath)).size };
    }
  });
  assert.equal(result.itemsFound, 3);
  assert.equal(result.itemsSaved, 3);
  assert.equal(downloaded, 3);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number }).n, 3);
  assert.ok(result.stoppedForLimit);
  const metadataRow = db.prepare('SELECT description, author, attribution, license, category, tags, source_page_url FROM images ORDER BY id LIMIT 1').get() as Record<string, string>;
  assert.equal(metadataRow.description, 'description-0');
  assert.equal(metadataRow.author, 'author-0');
  assert.equal(metadataRow.attribution, 'attribution-0');
  assert.equal(metadataRow.license, 'CC0 1.0');
  assert.equal(metadataRow.category, 'Fixture category');
  assert.equal(metadataRow.tags, 'tag-one | rare bird');
  assert.equal(metadataRow.source_page_url, source.url);
  const rows = db.prepare('SELECT filepath FROM images').all() as { filepath: string }[];
  for (const row of rows) await fs.promises.rm(path.join(env.imageStoragePath, row.filepath), { force: true });
  for (const directory of fs.readdirSync(env.imageStoragePath, { withFileTypes: true })) {
    if (directory.isDirectory() && !before.has(directory.name)) await fs.promises.rm(path.join(env.imageStoragePath, directory.name), { recursive: true, force: true });
  }
  db.close();
});

test('dry-run finds bounded URLs but does not download or change SQLite', async () => {
  const db = memoryDb();
  let downloads = 0;
  const result = await runImageCrawler({
    mode: 'dry', source, db,
    discovery: { crawl: async () => candidates(500) },
    downloader: async () => { downloads += 1; throw new Error('must not download'); }
  });
  assert.equal(result.urls.length, 5);
  assert.equal(downloads, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM crawler_runs').get() as { n: number }).n, 0);
  db.close();
});

test('Wikimedia candidates must be CC0 and use Commons file/image hosts', async () => {
  const commons: ImageSource = {
    name: 'Wikimedia Commons', type: 'image',
    url: 'https://commons.wikimedia.org/wiki/Category:CC-Zero',
    enabled: true, maxItems: 5, license: 'CC0 1.0'
  };
  const result = await runImageCrawler({
    mode: 'dry',
    source: commons,
    discovery: {
      crawl: async () => [
        { url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/good.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Good.jpg', license: 'CC0 1.0', category: 'animals', tags: ['Rare birds'] },
        { url: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/restricted.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Restricted.jpg', license: 'CC BY-SA 4.0', category: 'animals' },
        { url: 'https://images.example.test/unverified.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Other.jpg', license: 'CC0 1.0', category: 'animals' },
        { url: 'https://upload.wikimedia.org/wikipedia/commons/c/c1/jesus.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Jesus.jpg', license: 'CC0 1.0', category: 'animals', description: 'Jesus Christ' }
      ]
    }
  });
  assert.equal(result.itemsFound, 4);
  assert.equal(result.itemsSkipped, 3);
  assert.deepEqual(result.urls, ['https://upload.wikimedia.org/wikipedia/commons/a/a1/good.jpg']);
});

test('a source-specific item cap is honored', async () => {
  const result = await runImageCrawler({
    mode: 'dry', source: { ...source, maxItems: 2 },
    discovery: { crawl: async () => candidates(20) }
  });
  assert.equal(result.urls.length, 2);
});

test('duplicate source URLs are skipped without downloading on a repeated crawl', async () => {
  const db = memoryDb();
  const makeCandidates = async () => candidates(3);
  let downloaded = 0;
  const downloader = async (url: string) => {
    downloaded += 1;
    const filepath = path.join(env.tempStoragePath, `dedup-${downloaded}.download`);
    await fs.promises.mkdir(env.tempStoragePath, { recursive: true });
    await fs.promises.writeFile(filepath, await fixturePng(Number(new URL(url).pathname.slice(1, -4))));
    return { filepath, contentType: 'image/png', size: (await fs.promises.stat(filepath)).size };
  };
  const run = () => runImageCrawler({ mode: 'test', source, db, discovery: { crawl: makeCandidates }, downloader });
  const first = await run();
  const second = await run();
  assert.equal(first.itemsSaved, 3);
  assert.equal(second.itemsSaved, 0);
  assert.equal(downloaded, 3);
  const rows = db.prepare('SELECT filepath FROM images').all() as { filepath: string }[];
  for (const row of rows) await fs.promises.rm(path.join(env.imageStoragePath, row.filepath), { force: true });
  db.close();
});

test('identical image bytes from different URLs are deduplicated by SHA-256', async () => {
  const db = memoryDb();
  const imageBytes = await fixturePng(42);
  const result = await runImageCrawler({
    mode: 'test', source, db,
    discovery: { crawl: async () => candidates(3) },
    downloader: async (_url) => {
      const filepath = path.join(env.tempStoragePath, `same-content-${Math.random()}.download`);
      await fs.promises.mkdir(env.tempStoragePath, { recursive: true });
      await fs.promises.writeFile(filepath, imageBytes);
      return { filepath, contentType: 'image/png', size: imageBytes.length };
    }
  });
  assert.equal(result.itemsSaved, 1);
  assert.equal(result.itemsSkipped, 2);
  const row = db.prepare('SELECT filepath FROM images').get() as { filepath: string };
  await fs.promises.rm(path.join(env.imageStoragePath, row.filepath), { force: true });
  db.close();
});

test('invalid image downloads are skipped and the crawler continues safely', async () => {
  const db = memoryDb();
  const result = await runImageCrawler({
    mode: 'test', source, db,
    discovery: { crawl: async () => candidates(3) },
    downloader: async () => { throw new Error('Unsupported image content type: text/html'); }
  });
  assert.equal(result.itemsFound, 3);
  assert.equal(result.itemsSaved, 0);
  assert.equal(result.itemsSkipped, 3);
  db.close();
});

test('storage limit stops the crawler before storing the processed file', async () => {
  const db = memoryDb();
  const result = await runImageCrawler({
    mode: 'test', source, db, storageLimitBytes: 1,
    discovery: { crawl: async () => candidates(3) },
    downloader: async () => {
      const filepath = path.join(env.tempStoragePath, 'storage-limit.download');
      await fs.promises.mkdir(env.tempStoragePath, { recursive: true });
      await fs.promises.writeFile(filepath, await fixturePng(1));
      return { filepath, contentType: 'image/png', size: (await fs.promises.stat(filepath)).size };
    }
  });
  assert.ok(result.stoppedForLimit);
  assert.equal(result.itemsSaved, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number }).n, 0);
  db.close();
});

test('SHA-256 and image processor validate, resize and convert accepted files to WebP', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imgnest-image-'));
  const input = path.join(dir, 'not-really-a-jpg.jpg');
  await fs.promises.writeFile(input, await sharp({ create: { width: 4001, height: 60, channels: 3, background: 'red' } }).png().toBuffer());
  const firstHash = await sha256File(input);
  assert.match(firstHash, /^[a-f0-9]{64}$/);
  const output = await processImage(input);
  const webp = await fs.promises.readFile(output.filepath);
  assert.equal(webp.toString('ascii', 0, 4), 'RIFF');
  assert.equal(webp.toString('ascii', 8, 12), 'WEBP');
  assert.ok(output.width <= env.maxImageWidth && output.height <= env.maxImageHeight);
  assert.ok(output.width < 4001, 'oversized image should be resized');
  await removeFile(output.filepath);
  const broken = path.join(dir, 'broken.png');
  await fs.promises.writeFile(broken, 'not an image');
  await assert.rejects(() => processImage(broken), /Unsupported|Input|corrupt|Vips|image/i);
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('storage capacity rejects overflow and media resolution accepts only generated filenames', () => {
  assert.throws(() => assertStorageCapacity(900, 200, 1000), /storage limit/);
  assert.doesNotThrow(() => assertStorageCapacity(900, 100, 1000));
  assert.equal(resolveMediaPath('../../.env'), null);
  assert.equal(resolveMediaPath('a'.repeat(64) + '.webp'), path.join(env.imageStoragePath, 'aa', `${'a'.repeat(64)}.webp`));
});

test('API health, pagination, search, random, detail, stats and media path protection work', async () => {
  const db = memoryDb();
  const now = new Date().toISOString();
  const filepath = path.join(env.imageStoragePath, 'aa', `${'a'.repeat(64)}.webp`);
  await fs.promises.mkdir(path.dirname(filepath), { recursive: true });
  await fs.promises.writeFile(filepath, Buffer.from('test webp bytes'));
  insertImage(db, {
    filename: `${'a'.repeat(64)}.webp`, filepath: path.relative(env.imageStoragePath, filepath).split(path.sep).join('/'),
    title: 'Gaming Rare Bird', category: 'animals', description: 'A gaming test photo', author: 'Test Author', attribution: 'Test attribution', tags: 'rare birds | game',
    source: 'Test Source', source_url: 'https://example.test/image', source_page_url: 'https://example.test/page',
    license: 'CC0', width: 1, height: 1, mime_type: 'image/webp', file_size: 15,
    sha256: 'b'.repeat(64), created_at: now, updated_at: now
  });
  insertImage(db, {
    filename: `${'c'.repeat(64)}.webp`, filepath: `cc/${'c'.repeat(64)}.webp`,
    title: 'Jesus image', category: 'unclassified', description: 'legacy unclassified row', author: '', attribution: '', tags: '',
    source: 'legacy source', source_url: 'https://example.test/legacy.webp', source_page_url: 'https://example.test/legacy',
    license: 'Unknown', width: 1, height: 1, mime_type: 'image/webp', file_size: 12,
    sha256: 'd'.repeat(64), created_at: now, updated_at: now
  });
  const app = await buildServer(db);
  try {
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    const list = await app.inject('/api/images?page=1&limit=1');
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().total, 1);
    assert.equal(list.json().results[0].author, 'Test Author');
    assert.equal(list.json().results[0].description, 'A gaming test photo');
    assert.equal(list.json().results[0].attribution, 'Test attribution');
    assert.equal(list.json().results[0].sourceUrl, 'https://example.test/page');
    assert.equal((await app.inject('/api/images?page=1&limit=101')).statusCode, 400);
    assert.equal((await app.inject('/api/images/search?q=gaming')).json().results.length, 1);
    assert.equal((await app.inject('/api/images/search?q=rare%20bird')).json().results.length, 1);
    assert.equal((await app.inject('/api/images/search?q=jesus')).json().results.length, 0);
    assert.equal((await app.inject('/api/images/random')).statusCode, 200);
    assert.equal((await app.inject('/api/images/random?category=animals')).statusCode, 200);
    assert.equal((await app.inject('/api/images/random?category=unclassified')).statusCode, 404);
    assert.equal((await app.inject('/api/images/1')).statusCode, 200);
    assert.equal((await app.inject('/api/images/2')).statusCode, 404);
    assert.equal((await app.inject('/api/stats')).json().totalImages, 1);
    assert.equal((await app.inject('/media/images/../../.env')).statusCode, 404);
    assert.equal((await app.inject(`/media/images/${'a'.repeat(64)}.webp`)).statusCode, 200);
  } finally {
    await app.close();
    await fs.promises.rm(filepath, { force: true });
    db.close();
  }
});
