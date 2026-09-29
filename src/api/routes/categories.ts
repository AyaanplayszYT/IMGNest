import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

const availableCategories = [
  { name: 'animals', label: 'Animals' },
  { name: 'historical', label: 'Historical images' }
] as const;

export async function categoryRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get('/api/categories', async () => {
    const rows = db.prepare(`SELECT lower(category) AS category, COUNT(*) AS count
      FROM images WHERE lower(category) IN ('animals', 'historical') GROUP BY lower(category)`)
      .all() as Array<{ category: string; count: number }>;
    const counts = new Map(rows.map((row) => [row.category, row.count]));
    return {
      categories: availableCategories.map((category) => ({
        ...category,
        imageCount: counts.get(category.name) ?? 0
      }))
    };
  });
}
