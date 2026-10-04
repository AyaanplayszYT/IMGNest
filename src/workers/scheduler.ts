import { env } from '../config/env';
import { runImageCrawler } from '../crawlers/imageCrawler';

let isRunning = false;

export async function triggerCrawl(mode: 'normal' | 'test' = 'normal'): Promise<{ started: boolean; reason?: string; mode?: string }> {
  if (isRunning) {
    return { started: false, reason: 'A crawl is already in progress.' };
  }
  isRunning = true;
  runImageCrawler({ mode })
    .catch((error) => {
      console.error(`[WORKER] Crawl failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    })
    .finally(() => {
      isRunning = false;
    });
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
