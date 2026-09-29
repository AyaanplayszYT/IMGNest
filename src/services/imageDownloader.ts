import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { env } from '../config/env';
import { ensureStorageDirectories } from './storage';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

async function validateRemoteUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unsupported or unsafe image URL');
  }
  if (url.hostname.toLowerCase() === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new Error('Private image hosts are not allowed');
  }
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => {
    try { return ipaddr.parse(address).range() !== 'unicast'; } catch { return true; }
  })) throw new Error('Private image hosts are not allowed');
  return url;
}

export async function downloadImage(url: string, maxBytes = env.maxFileBytes): Promise<{ filepath: string; contentType: string; size: number }> {
  ensureStorageDirectories();
  const filepath = path.join(env.tempStoragePath, `${randomUUID()}.download`);
  let currentUrl = url;
  try {
    let response: Response | undefined;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      const parsed = await validateRemoteUrl(currentUrl);
      response = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(env.imageDownloadTimeoutMs) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirectCount === 3) throw new Error('Image redirect limit exceeded');
        currentUrl = new URL(location, parsed).toString();
        await response.body?.cancel();
        continue;
      }
      break;
    }
    if (!response?.ok || !response.body) throw new Error(`Image request failed (${response?.status ?? 'no response'})`);
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || '';
    if (!allowedTypes.has(contentType)) throw new Error(`Unsupported image content type: ${contentType || 'missing'}`);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('Image exceeds maximum download size');

    const handle = await fs.promises.open(filepath, 'wx');
    let size = 0;
    try {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error('Image exceeds maximum download size');
        }
        await handle.write(value);
      }
    } finally {
      await handle.close();
    }
    if (size === 0) throw new Error('Downloaded image is empty');
    return { filepath, contentType, size };
  } catch (error) {
    await fs.promises.rm(filepath, { force: true });
    throw error;
  }
}
