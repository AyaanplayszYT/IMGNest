import { env } from '../config/env';

export interface LiveImageResult {
  id?: number;
  title: string;
  category: string;
  description: string;
  author: string;
  attribution: string;
  tags: string[];
  image: string;
  source: string;
  sourceUrl: string;
  originalImageUrl: string;
  absoluteImage: string;
  license: string;
}

const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];

function stripHtml(input?: string): string {
  if (!input) return '';
  return input.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').trim();
}

/**
 * Perform a real-time search on Wikimedia Commons for CC0 images matching the requested category/query.
 * Returns direct full-resolution image URLs with CC0 licensing details.
 */
export async function searchLiveCC0Images(query: string, limit = 1): Promise<LiveImageResult[]> {
  const cleanQuery = query.replace(/[^\w\s-]/g, '').trim();
  if (!cleanQuery) return [];

  const targetLimit = Math.min(Math.max(limit, 1), 5);
  const searchTerms = [
    `${cleanQuery} incategory:"CC-Zero" filetype:bitmap`,
    `${cleanQuery} CC0 filetype:bitmap`,
    `${cleanQuery} filetype:bitmap`
  ];

  const userAgent = env.crawlerContactEmail
    ? `IMGNestBot/1.0 (${env.crawlerContactEmail})`
    : 'IMGNestBot/1.0 (contact@imgnest.local)';

  for (const q of searchTerms) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', q);
    url.searchParams.set('gsrnamespace', '6'); // File namespace
    url.searchParams.set('gsrlimit', String(targetLimit * 3));
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata');
    url.searchParams.set('format', 'json');

    try {
      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) continue;

      const data = await res.json() as {
        query?: {
          pages?: Record<string, {
            title?: string;
            imageinfo?: Array<{
              url?: string;
              descriptionurl?: string;
              extmetadata?: Record<string, { value?: string }>;
            }>;
          }>;
        };
      };

      const pages = Object.values(data.query?.pages || {});
      const results: LiveImageResult[] = [];

      for (const page of pages) {
        const rawTitle = page.title || '';
        const titleLower = rawTitle.toLowerCase();
        if (!supportedExtensions.some((ext) => titleLower.endsWith(ext))) continue;

        const info = page.imageinfo?.[0];
        if (!info || !info.url) continue;

        const cleanTitle = rawTitle.replace(/^File:/i, '').trim();
        const meta = info.extmetadata || {};
        const author = stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value);
        const description = stripHtml(meta.ImageDescription?.value) || cleanTitle;
        const pageUrl = info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(rawTitle)}`;
        const directImageUrl = info.url;

        results.push({
          title: cleanTitle.slice(0, 200),
          category: cleanQuery.toLowerCase(),
          description: description.slice(0, 500),
          author: author.slice(0, 200),
          attribution: author
            ? `${cleanTitle} by ${author} — CC0 1.0, Wikimedia Commons: ${pageUrl}`
            : `${cleanTitle} — CC0 1.0, Wikimedia Commons: ${pageUrl}`,
          tags: [cleanQuery.toLowerCase(), 'cc0', 'wikimedia'],
          image: directImageUrl,
          source: 'Wikimedia Commons',
          sourceUrl: pageUrl,
          originalImageUrl: directImageUrl,
          absoluteImage: directImageUrl,
          license: 'CC0 1.0'
        });

        if (results.length >= targetLimit) break;
      }

      if (results.length > 0) {
        return results;
      }
    } catch {
      // Continue to next search term on failure
    }
  }

  return [];
}
