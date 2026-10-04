import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import type { ImageRecord } from '../../services/database';
import { resolveMediaPath } from '../../services/storage';

const allowedCategories = new Set(['animals', 'birds', 'nature', 'architecture', 'art', 'general']);
const allowedCategorySql = "lower(category) IN ('animals', 'birds', 'nature', 'architecture', 'art', 'general')";

function publicImage(row: ImageRecord) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    author: row.author,
    attribution: row.attribution,
    tags: row.tags ? row.tags.split(' | ') : [],
    image: `/media/images/${row.filename}`,
    source: row.source,
    sourceUrl: row.source_page_url || row.source_url,
    originalImageUrl: row.source_url,
    license: row.license
  };
}

function integerParam(value: unknown, fallback: number, maximum: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= maximum ? number : null;
}

function searchImages(db: Database.Database, query: string, limit = 100, category?: string): ImageRecord[] {
  const tokens = query.toLowerCase().split(/\s+/).slice(0, 8);
  const categoryClause = category ? ' AND lower(category) = lower(?)' : '';
  const params = [...(category ? [category] : []), ...tokens, limit];
  return db.prepare(`SELECT * FROM images
    WHERE ${allowedCategorySql}${categoryClause}
      AND ${tokens.map(() => `instr(lower(title || ' ' || description || ' ' || author || ' ' || attribution || ' ' || tags || ' ' || category || ' ' || source), lower(?)) > 0`).join(' AND ')}
    ORDER BY id DESC LIMIT ?`).all(...params) as ImageRecord[];
}

export async function imageRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get('/api/images', async (request, reply) => {
    const { page: pageRaw, limit: limitRaw, category } = request.query as { page?: unknown; limit?: unknown; category?: unknown };
    const page = integerParam(pageRaw, 1, 10_000_000);
    const limit = integerParam(limitRaw, 20, 100);
    if (!page || !limit) return reply.code(400).send({ error: 'page and limit must be positive integers; limit cannot exceed 100' });
    if (category !== undefined && (typeof category !== 'string' || !allowedCategories.has(category.trim().toLowerCase()))) {
      return reply.code(400).send({ error: `category must be one of: ${[...allowedCategories].join(', ')}` });
    }
    const catClause = category ? ' AND lower(category) = lower(?)' : '';
    const catParams = category ? [String(category).trim()] : [];
    const total = Number((db.prepare(`SELECT COUNT(*) AS total FROM images WHERE ${allowedCategorySql}${catClause}`).get(...catParams) as { total: number }).total);
    const rows = db.prepare(`SELECT * FROM images WHERE ${allowedCategorySql}${catClause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...catParams, limit, (page - 1) * limit) as ImageRecord[];
    return { page, limit, total, results: rows.map(publicImage) };
  });

  app.get('/api/images/random', async (request, reply) => {
    const category = (request.query as { category?: unknown }).category;
    if (category !== undefined && (typeof category !== 'string' || !category.trim() || category.length > 100)) {
      return reply.code(400).send({ error: 'category must contain 1 to 100 characters' });
    }
    if (typeof category === 'string' && !allowedCategories.has(category.trim().toLowerCase())) {
      return reply.code(400).send({ error: `category must be one of: ${[...allowedCategories].join(', ')}` });
    }
    const row = category
      ? db.prepare(`SELECT * FROM images WHERE ${allowedCategorySql} AND lower(category) = lower(?) ORDER BY RANDOM() LIMIT 1`).get(category.trim()) as ImageRecord | undefined
      : db.prepare(`SELECT * FROM images WHERE ${allowedCategorySql} ORDER BY RANDOM() LIMIT 1`).get() as ImageRecord | undefined;
    if (!row) return reply.code(404).send({ error: 'No images found' });
    return publicImage(row);
  });

  app.get('/api/images/search', async (request, reply) => {
    const { q: query, category } = request.query as { q?: unknown; category?: unknown };
    if (typeof query !== 'string' || !query.trim() || query.length > 100) return reply.code(400).send({ error: 'q must contain 1 to 100 characters' });
    if (category !== undefined && (typeof category !== 'string' || !allowedCategories.has(category.trim().toLowerCase()))) {
      return reply.code(400).send({ error: `category must be one of: ${[...allowedCategories].join(', ')}` });
    }
    const selectedCategory = typeof category === 'string' ? category.trim() : undefined;
    return { query, category: selectedCategory ?? null, results: searchImages(db, query.trim(), 100, selectedCategory).map(publicImage) };
  });

  app.get('/api/images/category/:category', async (request, reply) => {
    const { category } = request.params as { category: string };
    if (!allowedCategories.has(category.trim().toLowerCase())) return reply.code(400).send({ error: `category must be one of: ${[...allowedCategories].join(', ')}` });
    const rows = db.prepare(`SELECT * FROM images WHERE ${allowedCategorySql} AND lower(category) = lower(?) ORDER BY id DESC LIMIT 100`).all(category) as ImageRecord[];
    return { category, results: rows.map(publicImage) };
  });

  app.get('/api/images/:id', async (request, reply) => {
    const id = integerParam((request.params as { id: string }).id, 0, Number.MAX_SAFE_INTEGER);
    if (!id) return reply.code(400).send({ error: 'id must be a positive integer' });
    const row = db.prepare(`SELECT * FROM images WHERE id = ? AND ${allowedCategorySql}`).get(id) as ImageRecord | undefined;
    if (!row) return reply.code(404).send({ error: 'Image not found' });
    return publicImage(row);
  });

  app.get('/media/images/:filename', async (request, reply) => {
    const filename = (request.params as { filename: string }).filename;
    const filePath = resolveMediaPath(filename);
    if (!filePath) return reply.code(404).send({ error: 'Image not found' });
    const stored = db.prepare(`SELECT filepath FROM images WHERE filename = ? AND ${allowedCategorySql}`).get(filename) as { filepath: string } | undefined;
    if (!stored) return reply.code(404).send({ error: 'Image not found' });
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      return reply.type('image/webp').header('Cache-Control', 'public, max-age=31536000, immutable').send(fs.createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: 'Image file not found' });
    }
  });
}

export { publicImage, searchImages };
