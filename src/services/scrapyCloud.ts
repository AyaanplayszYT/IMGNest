import { env } from '../config/env';

export interface ScrapedImageCandidate {
  url: string;
  title?: string;
  sourceUrl?: string;
  description?: string;
  author?: string;
  attribution?: string;
  license?: string;
  category?: string;
  tags?: string[];
}

export interface CloudCrawlRequest {
  sourceUrl: string;
  mode: 'normal' | 'test' | 'dry';
  maxItems: number;
  maxPages: number;
  maxRequests: number;
  historicalBeforeYear: number;
}

interface CloudConfig {
  apiKey: string;
  projectId: string;
  spider: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

function parseItems(text: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown[] }).items)) {
      return (parsed as { items: unknown[] }).items;
    }
  } catch { /* Scrapy Cloud can return JSON Lines depending on account/API defaults. */ }
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export class ScrapyCloudService {
  constructor(private readonly config: CloudConfig = {
    apiKey: env.scrapyCloudApiKey,
    projectId: env.scrapyCloudProjectId,
    spider: env.scrapyCloudSpider,
    timeoutMs: env.scrapyCloudTimeoutMs,
    pollIntervalMs: env.scrapyCloudPollIntervalMs
  }) {}

  async crawl(request: CloudCrawlRequest): Promise<ScrapedImageCandidate[]> {
    const { apiKey, projectId, spider, timeoutMs, pollIntervalMs } = this.config;
    if (!apiKey) throw new Error('SCRAPY_CLOUD_API_KEY is required to run the cloud spider');
    if (!/^\d+$/.test(projectId)) throw new Error('Set SCRAPY_CLOUD_PROJECT_ID to the numeric ID in your Scrapy Cloud project URL');
    if (!/^[a-zA-Z0-9_-]+$/.test(spider)) throw new Error('SCRAPY_CLOUD_SPIDER must be a valid spider name');
    if (!Number.isSafeInteger(request.maxItems) || request.maxItems < 1
      || !Number.isSafeInteger(request.maxPages) || request.maxPages < 1
      || !Number.isSafeInteger(request.maxRequests) || request.maxRequests < 1) {
      throw new Error('Cloud spider limits must be positive integers');
    }

    const runForm = new URLSearchParams({
      project: projectId,
      spider,
      source_url: request.sourceUrl,
      mode: request.mode,
      max_items: String(request.maxItems),
      max_pages: String(request.maxPages),
      max_requests: String(request.maxRequests),
      historical_before_year: String(request.historicalBeforeYear)
    });
    const sourceHost = new URL(request.sourceUrl).hostname;
    if (sourceHost === 'commons.wikimedia.org' || sourceHost.endsWith('.commons.wikimedia.org')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.crawlerContactEmail)) {
        throw new Error('Set CRAWLER_CONTACT_EMAIL to a valid contact address for Wikimedia');
      }
      runForm.set('contact_email', env.crawlerContactEmail);
    }
    const started = await this.requestJson('https://app.zyte.com/api/run.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: runForm
    });
    const jobId = (started as { jobid?: unknown }).jobid;
    if ((started as { status?: unknown }).status !== 'ok' || typeof jobId !== 'string'
      || !new RegExp(`^${projectId}/\\d+/\\d+$`).test(jobId)) {
      throw new Error('Scrapy Cloud did not return a valid job ID');
    }

    const deadline = Date.now() + timeoutMs;
    const maxPolls = Math.max(1, Math.min(120, Math.ceil(timeoutMs / pollIntervalMs)));
    let finished = false;
    for (let poll = 0; poll < maxPolls && Date.now() < deadline; poll += 1) {
      const jobsUrl = new URL('https://app.zyte.com/api/jobs/list.json');
      jobsUrl.searchParams.set('project', projectId);
      jobsUrl.searchParams.set('job', jobId);
      const status = await this.requestJson(jobsUrl.toString(), { method: 'GET' }) as {
        jobs?: Array<{ id?: string; state?: string; close_reason?: string; errors_count?: number }>;
      };
      const job = status.jobs?.find((candidate) => candidate.id === jobId) ?? status.jobs?.[0];
      if (!job) throw new Error('Scrapy Cloud could not find the started job');
      if (job.state === 'deleted') throw new Error('Scrapy Cloud job was deleted');
      if (job.state === 'finished') {
        if (job.close_reason && job.close_reason !== 'finished') {
          throw new Error(`Scrapy Cloud job ended: ${job.close_reason}`);
        }
        if (job.errors_count && job.errors_count > 0) throw new Error('Scrapy Cloud spider reported errors; inspect the job logs');
        finished = true;
        break;
      }
      if (job.state !== 'pending' && job.state !== 'running') {
        throw new Error(`Unexpected Scrapy Cloud job state: ${job.state || 'unknown'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    if (!finished) {
      const stopForm = new URLSearchParams({ project: projectId, job: jobId });
      try {
        await this.requestJson('https://app.zyte.com/api/jobs/stop.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: stopForm
        });
      } catch { /* Preserve the timeout; the configured crawler caps still bound the job. */ }
      throw new Error('Timed out waiting for the Scrapy Cloud job to finish');
    }

    const itemsUrl = new URL(`https://storage.zyte.com/items/${jobId}`);
    itemsUrl.searchParams.set('count', String(request.maxItems));
    itemsUrl.searchParams.set('format', 'json');
    const response = await this.authorizedFetch(itemsUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Scrapy Cloud items request failed (${response.status})`);
    const items = parseItems(await response.text());
    const candidates: ScrapedImageCandidate[] = [];
    for (const value of items) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      if (typeof item.url !== 'string') continue;
      let parsed: URL;
      try { parsed = new URL(item.url); } catch { continue; }
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      candidates.push({
        url: parsed.toString(),
        title: typeof item.title === 'string' ? item.title.slice(0, 200) : undefined,
        sourceUrl: typeof item.source_url === 'string' ? item.source_url : request.sourceUrl,
        description: typeof item.description === 'string' ? item.description.slice(0, 2000) : undefined,
        author: typeof item.author === 'string' ? item.author.slice(0, 300) : undefined,
        attribution: typeof item.attribution === 'string' ? item.attribution.slice(0, 1000) : undefined,
        license: typeof item.license === 'string' ? item.license.slice(0, 100) : undefined,
        category: typeof item.category === 'string' ? item.category.slice(0, 200) : undefined,
        tags: Array.isArray(item.tags)
          ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 30).map((tag) => tag.slice(0, 100))
          : undefined
      });
      if (candidates.length >= request.maxItems) break;
    }
    return candidates;
  }

  private async requestJson(url: string, init: RequestInit): Promise<unknown> {
    const response = await this.authorizedFetch(url, init);
    if (!response.ok) {
      const details = (await response.text()).slice(0, 300);
      throw new Error(`Scrapy Cloud request failed (${response.status}): ${details}`);
    }
    return response.json();
  }

  private authorizedFetch(url: string, init: RequestInit): Promise<Response> {
    const auth = Buffer.from(`${this.config.apiKey}:`).toString('base64');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Basic ${auth}`);
    return fetch(url, { ...init, headers, signal: AbortSignal.timeout(this.config.timeoutMs) });
  }
}
