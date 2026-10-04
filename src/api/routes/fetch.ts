import type { FastifyInstance, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import type { ImageRecord } from '../../services/database';
import { resolveMediaPath } from '../../services/storage';
import { RateLimiter } from '../../services/rateLimiter';
import { searchLiveCC0Images } from '../../services/liveSearch';
import { env } from '../../config/env';

// ------------------------------------------------------------------
// Rate limiter — shared across all requests to this endpoint.
// Window / max are pulled from env so ops can tune without a redeploy.
// ------------------------------------------------------------------
const limiter = new RateLimiter(env.fetchRateLimitWindowMs, env.fetchRateLimitMax);

// Prune stale buckets every 5 minutes to keep memory footprint tiny.
setInterval(() => limiter.prune(), 5 * 60 * 1000).unref();

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

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

/** Return the client IP, preferring X-Forwarded-For when behind a proxy. */
function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded)) return forwarded[0].trim();
  return request.ip ?? 'unknown';
}

// ------------------------------------------------------------------
// Route
// ------------------------------------------------------------------

export async function fetchRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  /**
   * GET /api/images/fetch
   *
   * Query params:
   *   category  (required) — e.g. "birds", "animals", "cats", "nature", "space"
   *   limit     (optional) — 1–5, default 1
   *
   * Designed for Discord bots: /imgnest category:birds limit:5
   *
   * If local DB has matching images, returns them.
   * If local DB has fewer images or is empty, performs an on-demand live
   * search for verified CC0 images and returns them immediately without
   * consuming local server disk space.
   */
  app.get('/api/images/fetch', async (request, reply) => {
    // ── Rate limit ──────────────────────────────────────────────────
    const ip = clientIp(request);
    const rl = limiter.consume(ip);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
      return reply
        .code(429)
        .header('Retry-After', String(retryAfterSec))
        .send({
          error: 'Rate limit exceeded. Slow down!',
          retryAfterSeconds: retryAfterSec
        });
    }

    // ── Validate category ────────────────────────────────────────────
    const { category, limit: limitRaw } = request.query as { category?: unknown; limit?: unknown };

    if (typeof category !== 'string' || !category.trim() || category.length > 100) {
      return reply.code(400).send({
        error: 'category is required and must be 1–100 characters'
      });
    }

    const categoryNorm = category.trim().toLowerCase();

    // ── Validate limit ───────────────────────────────────────────────
    const FETCH_MAX_LIMIT = 5;
    let limit = 1;
    if (limitRaw !== undefined) {
      if (typeof limitRaw !== 'string' || !/^\d+$/.test(limitRaw)) {
        return reply.code(400).send({ error: 'limit must be a positive integer between 1 and 5' });
      }
      limit = Number(limitRaw);
      if (limit < 1 || limit > FETCH_MAX_LIMIT) {
        return reply.code(400).send({ error: `limit must be between 1 and ${FETCH_MAX_LIMIT}` });
      }
    }

    // ── 1. Check local DB first ──────────────────────────────────────
    const dbRows = db
      .prepare(
        `SELECT * FROM images
         WHERE lower(category) = ?
            OR instr(lower(tags || ' ' || title || ' ' || description), ?) > 0
         ORDER BY RANDOM()
         LIMIT ?`
      )
      .all(categoryNorm, categoryNorm, limit) as ImageRecord[];

    const results = dbRows.map((row) => {
      const pub = publicImage(row);
      const absoluteImage = resolveMediaPath(row.filename)
        ? `${env.publicBaseUrl}/media/images/${row.filename}`
        : pub.originalImageUrl;
      return { ...pub, absoluteImage };
    });

    // ── 2. On-demand live search if DB has fewer than requested ───────
    if (results.length < limit) {
      const needed = limit - results.length;
      try {
        const liveImages = await searchLiveCC0Images(categoryNorm, needed);
        for (const live of liveImages) {
          // Avoid duplicate URLs in response
          if (!results.some((r) => r.originalImageUrl === live.originalImageUrl)) {
            results.push({
              ...live,
              id: live.id ?? Math.floor(Math.random() * 1_000_000) + 100_000
            });
          }
        }
      } catch {
        // If live search fails, proceed with whatever was found in DB
      }
    }

    if (results.length === 0) {
      return reply.code(404).send({
        error: `No CC0 images found for "${category}". Try another keyword or category.`
      });
    }

    return reply.send({
      category: categoryNorm,
      limit,
      count: results.length,
      results
    });
  });
}
