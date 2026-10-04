import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import { env } from '../../config/env';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${Number(value.toFixed(1))} ${units[unit]}`;
}

export async function statsRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get('/api/stats', async () => {
    const publicCategories = "lower(category) = 'animals'";
    const count = db.prepare(`SELECT COUNT(*) AS total FROM images WHERE ${publicCategories}`).get() as { total: number };
    const storage = db.prepare('SELECT COALESCE(SUM(file_size), 0) AS size FROM images').get() as { size: number };
    const runs = db.prepare('SELECT COUNT(*) AS total FROM crawler_runs').get() as { total: number };
    let databaseSize = 0;
    try { databaseSize = fs.statSync(env.databasePath).size; } catch { /* database may be in-memory in tests */ }
    return {
      totalImages: count.total,
      storageUsed: formatBytes(storage.size),
      databaseSize: formatBytes(databaseSize),
      crawlerRuns: runs.total
    };
  });
}
