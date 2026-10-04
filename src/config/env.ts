import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

function positiveInt(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be between 1 and ${max}`);
  }
  return value;
}

function enabled(raw: string | undefined): boolean {
  return raw?.toLowerCase() === 'true';
}

const root = process.cwd();
const production = process.env.NODE_ENV === 'production';

export const env = {
  nodeEnv: production ? 'production' : 'development',
  isProduction: production,
  port: positiveInt('PORT', 25585, 65535),
  host: process.env.HOST || '0.0.0.0',
  databasePath: path.resolve(root, process.env.DATABASE_PATH || (production ? '/data/app.db' : './data/dev.db')),
  imageStoragePath: path.resolve(root, process.env.IMAGE_STORAGE_PATH || (production ? '/data/images' : './data/images')),
  tempStoragePath: path.resolve(root, process.env.TEMP_STORAGE_PATH || (production ? '/data/tmp' : './data/tmp')),
  maxStorageBytes: positiveInt('MAX_STORAGE_MB', 9000) * 1024 * 1024,
  crawlerSourceUrl: process.env.CRAWLER_SOURCE_URL?.trim() || 'https://commons.wikimedia.org/wiki/Category:CC-Zero',
  crawlerSourceName: process.env.CRAWLER_SOURCE_NAME?.trim() || 'Wikimedia Commons CC-Zero',
  crawlerSourceLicense: process.env.CRAWLER_SOURCE_LICENSE?.trim() || 'CC0 1.0',
  crawlerContactEmail: process.env.CRAWLER_CONTACT_EMAIL?.trim() || '',
  crawler: {
    maxItems: positiveInt('CRAWLER_MAX_ITEMS', 5),
    maxDownloads: positiveInt('CRAWLER_MAX_DOWNLOADS', 5),
    maxPages: positiveInt('CRAWLER_MAX_PAGES', 1),
    maxRequests: positiveInt('CRAWLER_MAX_REQUESTS', 5)
  },
  testCrawler: {
    maxItems: positiveInt('TEST_MAX_ITEMS', 3, 3),
    maxDownloads: positiveInt('TEST_MAX_DOWNLOADS', 3, 3),
    maxPages: positiveInt('TEST_MAX_PAGES', 1, 1)
  },
  maxFileBytes: positiveInt('MAX_FILE_SIZE_MB', 10) * 1024 * 1024,
  maxImageWidth: positiveInt('MAX_IMAGE_WIDTH', 3000),
  maxImageHeight: positiveInt('MAX_IMAGE_HEIGHT', 3000),
  scrapyCloudApiKey: process.env.SCRAPY_CLOUD_API_KEY?.trim() || '',
  scrapyCloudProjectId: process.env.SCRAPY_CLOUD_PROJECT_ID?.trim() || '',
  scrapyCloudSpider: process.env.SCRAPY_CLOUD_SPIDER?.trim() || 'imgnest_images',
  scrapyCloudTimeoutMs: positiveInt('SCRAPY_CLOUD_TIMEOUT_MS', 120000),
  scrapyCloudPollIntervalMs: positiveInt('SCRAPY_CLOUD_POLL_INTERVAL_MS', 1000, 10000),
  imageDownloadTimeoutMs: positiveInt('IMAGE_DOWNLOAD_TIMEOUT_MS', 15000),
  enableScheduler: enabled(process.env.ENABLE_SCHEDULER),
  crawlerIntervalMinutes: positiveInt('CRAWLER_INTERVAL_MINUTES', 60),
  // Fetch endpoint rate-limiting
  fetchRateLimitWindowMs: positiveInt('FETCH_RATE_LIMIT_WINDOW_MS', 10000), // 10 s window
  fetchRateLimitMax: positiveInt('FETCH_RATE_LIMIT_MAX', 5),               // max 5 requests/window
  // Public base URL used to build absolute image links (no trailing slash)
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
};

export { positiveInt };
