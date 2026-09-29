import { env } from './env';

export interface ImageSource {
  name: string;
  type: 'image';
  url: string;
  enabled: boolean;
  maxItems: number;
  license: string;
}

// V1 uses Wikimedia Commons' CC-Zero category; additional sources can be added later.
export const sources: ImageSource[] = [
  {
    name: env.crawlerSourceName,
    type: 'image',
    url: env.crawlerSourceUrl,
    enabled: Boolean(env.crawlerSourceUrl),
    maxItems: env.crawler.maxItems,
    license: env.crawlerSourceLicense
  }
];

export function getActiveSource(): ImageSource {
  const source = sources.find((candidate) => candidate.enabled);
  if (!source) throw new Error('No crawler source configured. Set CRAWLER_SOURCE_URL to a permitted source.');
  const url = new URL(source.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Crawler source must use HTTP or HTTPS');
  return source;
}
