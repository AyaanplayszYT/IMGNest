import { runImageCrawler, type CrawlMode } from './imageCrawler';

async function main(): Promise<void> {
  const mode = process.argv[2] as CrawlMode;
  if (!['normal', 'test', 'dry'].includes(mode)) throw new Error('Usage: crawl [normal|test|dry] [--limit=N]');
  const arg = process.argv.slice(3).find((value) => value.startsWith('--limit'));
  let limitOverride: number | undefined;
  if (arg) {
    const raw = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : process.argv[process.argv.indexOf(arg) + 1];
    if (!raw || !/^\d+$/.test(raw)) throw new Error('--limit must be a positive integer');
    limitOverride = Number(raw);
    if (!Number.isSafeInteger(limitOverride) || limitOverride < 1) throw new Error('--limit must be a positive integer');
  }
  await runImageCrawler({ mode, limitOverride });
}

main().catch((error: unknown) => {
  console.error(`[CRAWLER] ${error instanceof Error ? error.message : 'Crawler failed'}`);
  process.exitCode = 1;
});
