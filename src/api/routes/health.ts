import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import { env } from '../../config/env';

export async function healthRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get('/api/health', async (_request, reply) => {
    try {
      db.prepare('SELECT 1').get();
      const storageOk = fs.existsSync(env.imageStoragePath) && fs.statSync(env.imageStoragePath).isDirectory();
      return reply.code(storageOk ? 200 : 503).send({
        status: storageOk ? 'ok' : 'degraded',
        database: 'connected',
        storage: storageOk ? 'ok' : 'unavailable',
        uptime: Math.floor(process.uptime())
      });
    } catch {
      return reply.code(503).send({ status: 'error', database: 'disconnected', storage: 'unavailable', uptime: Math.floor(process.uptime()) });
    }
  });
}
