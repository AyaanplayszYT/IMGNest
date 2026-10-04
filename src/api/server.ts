import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { openDatabase } from '../services/database';
import { ensureStorageDirectories } from '../services/storage';
import { healthRoutes } from './routes/health';
import { imageRoutes } from './routes/images';
import { statsRoutes } from './routes/stats';
import { categoryRoutes } from './routes/categories';
import { fetchRoutes } from './routes/fetch';

export async function buildServer(database?: Database.Database): Promise<FastifyInstance> {
  const db = database ?? openDatabase();
  ensureStorageDirectories();
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.decorate('imgnestDb', db);
  app.addHook('onClose', async () => { if (!database) db.close(); });
  await healthRoutes(app, db);
  await imageRoutes(app, db);
  await categoryRoutes(app, db);
  await fetchRoutes(app, db);
  await statsRoutes(app, db);
  return app;
}
