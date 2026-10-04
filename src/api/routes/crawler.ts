import type { FastifyInstance } from 'fastify';
import { triggerCrawl, isCrawlRunning } from '../../workers/scheduler';

export async function crawlerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/crawl/status
   * 
   * Checks whether a crawler run is currently in progress.
   */
  app.get('/api/crawl/status', async () => {
    return {
      isRunning: isCrawlRunning()
    };
  });

  /**
   * POST /api/crawl
   * 
   * Triggers a crawler run.
   * Query params:
   *   mode (optional): "test" (default, 3 items) or "normal" (up to CRAWLER_MAX_ITEMS)
   *   wait (optional): "true" to block and return saved images upon completion
   */
  app.post('/api/crawl', async (request, reply) => {
    const query = request.query as { mode?: string; wait?: string };
    const mode = query.mode === 'normal' ? 'normal' : 'test';
    const shouldWait = query.wait === 'true' || query.wait === '1';

    const result = await triggerCrawl(mode, shouldWait);
    if (!result.started) {
      return reply.code(409).send({
        status: 'busy',
        error: result.reason || 'A crawl is already under progress.'
      });
    }

    if (shouldWait && result.result) {
      return reply.code(200).send({
        status: 'completed',
        mode,
        itemsFound: result.result.itemsFound,
        itemsSaved: result.result.itemsSaved,
        itemsSkipped: result.result.itemsSkipped,
        images: result.result.savedImages ?? []
      });
    }

    return reply.code(202).send({
      status: 'started',
      mode,
      message: `Crawl (${mode}) started in background. Watch server console or check /api/stats.`
    });
  });
}
