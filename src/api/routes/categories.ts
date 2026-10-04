import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

const knownCategories = [
  { name: 'animals', label: 'Animals' },
  { name: 'birds', label: 'Birds' },
  { name: 'nature', label: 'Nature' },
  { name: 'architecture', label: 'Architecture' },
  { name: 'art', label: 'Art' },
  { name: 'general', label: 'General' }
] as const;

export async function categoryRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get('/api/categories', async () => {
    const rows = db.prepare(`SELECT lower(category) AS category, COUNT(*) AS count
      FROM images WHERE lower(category) IN ('animals', 'birds', 'nature', 'architecture', 'art', 'general')
      GROUP BY lower(category)`)
      .all() as Array<{ category: string; count: number }>;
    const counts = new Map(rows.map((row) => [row.category, row.count]));
    return {
      categories: knownCategories.map((category) => ({
        ...category,
        imageCount: counts.get(category.name) ?? 0
      }))
    };
  });
}
