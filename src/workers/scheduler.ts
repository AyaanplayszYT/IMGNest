import { env } from '../config/env';
import { runImageCrawler, type CrawlResult } from '../crawlers/imageCrawler';

let isRunning = false;
let activeCrawlPromise: Promise<CrawlResult> | null = null;

export function isCrawlRunning(): boolean {
  return isRunning;
}

export async function triggerCrawl(
  mode: 'normal' | 'test' = 'normal',
  wait = false
): Promise<{ started: boolean; reason?: string; mode?: string; result?: CrawlResult }> {
  if (isRunning) {
    return { started: false, reason: 'A crawl is already in progress.' };
  }
  isRunning = true;
  activeCrawlPromise = runImageCrawler({ mode })
    .catch((error) => {
      console.error(`[WORKER] Crawl failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    })
    .finally(() => {
      isRunning = false;
      activeCrawlPromise = null;
    });

  if (wait) {
    try {
      const result = await activeCrawlPromise;
      return { started: true, mode, result };
    } catch (error) {
      return { started: false, reason: error instanceof Error ? error.message : 'Crawl failed' };
    }
  }

  return { started: true, mode };
}

export function startScheduler(): void {
  if (!env.enableScheduler) {
    console.log('  \x1b[2mworker  scheduler disabled (ENABLE_SCHEDULER=false)\x1b[0m\n');
    return;
  }
  const intervalMs = env.crawlerIntervalMinutes * 60 * 1000;
  console.log(`  \x1b[32mworker\x1b[0m  scheduler enabled (interval: ${env.crawlerIntervalMinutes}m)\n`);

  // Run an initial test crawl 5 seconds after startup
  setTimeout(() => {
    console.log('[WORKER] Starting initial background crawl...');
    void triggerCrawl('test');
  }, 5000);

  const timer = setInterval(() => {
    void triggerCrawl('normal');
  }, intervalMs);

  const stop = () => { clearInterval(timer); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// Support standalone execution: node dist/workers/scheduler.js
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scheduler.js')) {
  startScheduler();
}
