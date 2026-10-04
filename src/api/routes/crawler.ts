import type { FastifyInstance } from 'fastify';
import { triggerCrawl } from '../../workers/scheduler';

export async function crawlerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/crawl
   * 
   * Triggers an asynchronous crawler run in the background.
   * Query params:
   *   mode (optional): "test" (default, 3 items) or "normal" (up to CRAWLER_MAX_ITEMS)
   */
  app.post('/api/crawl', async (request, reply) => {
    const query = request.query as { mode?: string };
    const mode = query.mode === 'normal' ? 'normal' : 'test';

    const result = await triggerCrawl(mode);
    if (!result.started) {
      return reply.code(409).send({
        status: 'conflict',
        error: result.reason
      });
    }

    return reply.code(202).send({
      status: 'started',
      mode,
      message: `Crawl (${mode}) started in background. Watch server console or check /api/stats.`
    });
  });
}
