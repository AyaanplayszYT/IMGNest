import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { env } from '../config/env';
import { getActiveSource, type ImageSource } from '../config/sources';
import { openDatabase, imageByHash, imageBySourceUrl, insertImage } from '../services/database';
import { sha256File, removeFile } from '../services/deduplication';
import { downloadImage } from '../services/imageDownloader';
import { processImage } from '../services/imageProcessor';
import { assertStorageCapacity, ensureStorageDirectories, pathForHash } from '../services/storage';
import { ScrapyCloudService, type ScrapedImageCandidate } from '../services/scrapyCloud';

export type CrawlMode = 'normal' | 'test' | 'dry';
type Limits = { maxItems: number; maxDownloads: number; maxPages: number; maxRequests: number };
type CrawlerOptions = {
  mode: CrawlMode;
  limitOverride?: number;
  source?: ImageSource;
  discovery?: Pick<ScrapyCloudService, 'crawl'>;
  db?: Database.Database;
  downloader?: typeof downloadImage;
  processor?: typeof processImage;
  storageLimitBytes?: number;
};

export interface CrawlResult {
  mode: CrawlMode;
  itemsFound: number;
  itemsSaved: number;
  itemsSkipped: number;
  urls: string[];
  stoppedForLimit: boolean;
}

const blockedCommonsMetadata = /\b(jesus|christ|christian(?:s|ity)?|religions?|religious|bible|biblical|church(?:es)?|worship|prayers?|saints?|nude|nudity|naked|porn|pornography|sexual|sex|erotic|genital|explicit|nsfw|mature|gore|blood|corpse|torture|rape|suicide|self[- ]harm|graphic violence|crucifixion)\b/i;

const hardLimits = {
  development: { maxItems: 5, maxDownloads: 5, maxPages: 1, maxRequests: 5 },
  production: { maxItems: 100, maxDownloads: 100, maxPages: 10, maxRequests: 20 },
  test: { maxItems: 3, maxDownloads: 3, maxPages: 1, maxRequests: 2 }
} satisfies Record<string, Limits>;

export function getCrawlLimits(mode: CrawlMode, limitOverride?: number, sourceMaxItems?: number): Limits {
  if (limitOverride !== undefined && (!Number.isSafeInteger(limitOverride) || limitOverride < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  if (sourceMaxItems !== undefined && (!Number.isSafeInteger(sourceMaxItems) || sourceMaxItems < 1)) {
    throw new Error('Source maxItems must be a positive integer');
  }
  const hard = mode === 'test' ? hardLimits.test : env.isProduction ? hardLimits.production : hardLimits.development;
  const configured = mode === 'test'
    ? { ...env.testCrawler, maxRequests: 2 }
    : env.crawler;
  const source = mode === 'test' ? 3 : env.crawler.maxItems;
  return {
    maxItems: Math.min(configured.maxItems, hard.maxItems, source, sourceMaxItems ?? Number.MAX_SAFE_INTEGER, limitOverride ?? Number.MAX_SAFE_INTEGER),
    maxDownloads: Math.min(configured.maxDownloads, hard.maxDownloads, limitOverride ?? Number.MAX_SAFE_INTEGER),
    maxPages: Math.min(configured.maxPages, hard.maxPages),
    maxRequests: Math.min(configured.maxRequests, hard.maxRequests)
  };
}

export async function runImageCrawler(options: CrawlerOptions): Promise<CrawlResult> {
  const { mode } = options;
  const source = options.source ?? getActiveSource();
  const limits = getCrawlLimits(mode, options.limitOverride, source.maxItems);
  if (!source.enabled || !source.url) throw new Error('Crawler source is disabled or has no URL');
  if (limits.maxItems < 1 || limits.maxDownloads < 1 || limits.maxPages < 1 || limits.maxRequests < 1) {
    throw new Error('Crawler limits must all be positive');
  }
  console.log(`[CRAWLER] Starting`);
  console.log(`[CRAWLER] Mode: ${mode === 'test' ? 'TEST' : mode.toUpperCase()}`);
  console.log(`[CRAWLER] Maximum items: ${limits.maxItems}`);

  const result: CrawlResult = { mode, itemsFound: 0, itemsSaved: 0, itemsSkipped: 0, urls: [], stoppedForLimit: false };
  const discovery = options.discovery ?? new ScrapyCloudService();
  const downloader = options.downloader ?? downloadImage;
  const processor = options.processor ?? processImage;
  const dry = mode === 'dry';
  const commonsSource = new URL(source.url).hostname === 'commons.wikimedia.org';
  const db = dry ? undefined : options.db ?? openDatabase();
  const ownsDb = !dry && !options.db;
  let runId: number | undefined;
  const startedAt = new Date().toISOString();
  if (db) {
    ensureStorageDirectories();
    runId = Number(db.prepare(`INSERT INTO crawler_runs (crawler, mode, started_at, status) VALUES (?, ?, ?, 'running')`)
      .run('image', mode, startedAt).lastInsertRowid);
  }

  let status: 'completed' | 'failed' = 'completed';
  let errorMessage: string | null = null;
  let downloadCount = 0;
  try {
    console.log(`[CRAWLER] Starting Scrapy Cloud spider: ${env.scrapyCloudSpider}`);
    const discovered: ScrapedImageCandidate[] = await discovery.crawl({
      sourceUrl: source.url,
      mode,
      maxItems: limits.maxItems,
      maxPages: limits.maxPages,
      maxRequests: limits.maxRequests
    });
    for (const candidate of discovered.slice(0, limits.maxItems)) {
      if (result.itemsFound >= limits.maxItems || downloadCount >= limits.maxDownloads) break;
      const imageUrl = candidate.url;
      result.itemsFound += 1;
      const sourceUrl = candidate.sourceUrl || imageUrl;
      if (commonsSource) {
        let imageHost = '';
        try { imageHost = new URL(imageUrl).hostname.toLowerCase(); } catch { /* invalid URLs are rejected below */ }
        let page: URL | undefined;
        try { page = new URL(sourceUrl); } catch { /* invalid source page */ }
        const allowedCrawlerCategories = new Set(['animals', 'birds', 'nature', 'architecture', 'art', 'general']);
        const metadataText = [candidate.title, candidate.description, candidate.author, candidate.attribution, ...(candidate.tags ?? [])].filter(Boolean).join(' ');
        if (!['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(imageHost)
          || page?.hostname !== 'commons.wikimedia.org' || !page.pathname.startsWith('/wiki/File:')
          || !/^cc0(?:\s|$)/i.test(candidate.license || '')
          || !candidate.category || !allowedCrawlerCategories.has(candidate.category.toLowerCase())
          || blockedCommonsMetadata.test(metadataText)) {
          result.itemsSkipped += 1;
          console.warn('[CRAWLER] Skipped Commons item outside allowed topics or without verified CC0 metadata');
          continue;
        }
      }
      result.urls.push(imageUrl);
      console.log(`[CRAWLER] Found image ${result.itemsFound}/${limits.maxItems}: ${imageUrl}`);
      if (dry) continue;

      if (imageBySourceUrl(db!, imageUrl)) {
        result.itemsSkipped += 1;
        console.log('[CRAWLER] Duplicate source URL; skipped');
        continue;
      }
      downloadCount += 1;
      let downloadedPath: string | undefined;
      let processedPath: string | undefined;
      try {
        console.log(`[PROCESSOR] Downloading ${downloadCount}/${limits.maxDownloads}`);
        const downloaded = await downloader(imageUrl);
        downloadedPath = downloaded.filepath;
        const rawHash = await sha256File(downloaded.filepath);
        if (imageByHash(db!, rawHash)) {
          result.itemsSkipped += 1;
          console.log('[CRAWLER] Duplicate image content; skipped');
          continue;
        }

        const processed = await processor(downloaded.filepath);
        processedPath = processed.filepath;
        const savedHash = await sha256File(processed.filepath);
        const destination = pathForHash(savedHash);
        const storageRow = db!.prepare('SELECT COALESCE(SUM(file_size), 0) AS size FROM images').get() as { size: number };
        const storageUsed = Number(storageRow.size);
        assertStorageCapacity(storageUsed, processed.size, options.storageLimitBytes);
        await fs.promises.mkdir(path.dirname(destination.filepath), { recursive: true });
        try {
          await fs.promises.copyFile(processed.filepath, destination.filepath, fs.constants.COPYFILE_EXCL);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          result.itemsSkipped += 1;
          continue;
        }
        const now = new Date().toISOString();
        try {
          insertImage(db!, {
            filename: destination.filename,
            filepath: path.relative(env.imageStoragePath, destination.filepath).split(path.sep).join('/'),
            title: candidate.title?.trim() || source.name,
            category: candidate.category?.trim() || '',
            description: candidate.description?.trim() || '',
            author: candidate.author?.trim() || '',
            attribution: candidate.attribution?.trim() || '',
            tags: (candidate.tags ?? []).join(' | '),
            source: source.name,
            source_url: imageUrl,
            source_page_url: sourceUrl,
            license: candidate.license?.trim() || source.license,
            width: processed.width,
            height: processed.height,
            mime_type: 'image/webp',
            file_size: processed.size,
            sha256: rawHash,
            created_at: now,
            updated_at: now
          });
        } catch (error) {
          await fs.promises.rm(destination.filepath, { force: true });
          throw error;
        }
        result.itemsSaved += 1;
        console.log(`[PROCESSOR] Saved ${destination.filename}`);
      } catch (error) {
        result.itemsSkipped += 1;
        const message = error instanceof Error ? error.message : 'Unknown image error';
        console.warn(`[CRAWLER] Image skipped: ${message}`);
        if (message === 'Image storage limit reached') {
          result.stoppedForLimit = true;
          break;
        }
      } finally {
        if (downloadedPath) await removeFile(downloadedPath).catch(() => {});
        if (processedPath) await removeFile(processedPath).catch(() => {});
      }
    }
    if (result.itemsFound >= limits.maxItems || downloadCount >= limits.maxDownloads) {
      result.stoppedForLimit = true;
      console.log('[CRAWLER] Maximum reached');
    }
    if (dry) {
      console.log('\n[DRY RUN]\nFound:');
      result.urls.forEach((url, index) => console.log(`${index + 1}. ${url}`));
      console.log('No files downloaded.\nNo database changes made.');
    }
  } catch (error) {
    status = 'failed';
    errorMessage = error instanceof Error ? error.message : 'Unknown crawler error';
    throw error;
  } finally {
    if (db && runId !== undefined) {
      db.prepare(`UPDATE crawler_runs SET finished_at = ?, status = ?, items_found = ?, items_saved = ?, items_skipped = ?, error_message = ? WHERE id = ?`)
        .run(new Date().toISOString(), status, result.itemsFound, result.itemsSaved, result.itemsSkipped, errorMessage, runId);
    }
    if (ownsDb) db?.close();
    console.log('[CRAWLER] Finished');
  }
  return result;
}
