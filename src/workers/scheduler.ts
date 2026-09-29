import { env } from '../config/env';
import { runImageCrawler } from '../crawlers/imageCrawler';

if (!env.enableScheduler) {
  console.log('[WORKER] Scheduler disabled (ENABLE_SCHEDULER=false).');
} else {
  const intervalMs = env.crawlerIntervalMinutes * 60 * 1000;
  let running = false;
  console.log(`[WORKER] Scheduler enabled; crawler runs every ${env.crawlerIntervalMinutes} minutes.`);
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await runImageCrawler({ mode: 'normal' }); }
    catch (error) { console.error(`[WORKER] Crawl failed: ${error instanceof Error ? error.message : 'Unknown error'}`); }
    finally { running = false; }
  }, intervalMs);
  const stop = () => { clearInterval(timer); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
