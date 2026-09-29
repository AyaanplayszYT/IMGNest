import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';

export function ensureStorageDirectories(): void {
  for (const directory of [env.imageStoragePath, env.tempStoragePath]) fs.mkdirSync(directory, { recursive: true });
}

export function pathForHash(hash: string, root = env.imageStoragePath): { filename: string; filepath: string } {
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid image hash');
  const filename = `${hash.toLowerCase()}.webp`;
  const filepath = path.join(root, hash.slice(0, 2).toLowerCase(), filename);
  return { filename, filepath };
}

export function assertStorageCapacity(currentBytes: number, nextBytes: number, limitBytes = env.maxStorageBytes): void {
  if (nextBytes < 0 || currentBytes + nextBytes > limitBytes) throw new Error('Image storage limit reached');
}

export function resolveMediaPath(filename: string, root = env.imageStoragePath): string | null {
  if (!/^[a-f0-9]{64}\.webp$/i.test(filename)) return null;
  const candidate = path.resolve(root, filename.slice(0, 2), filename);
  const resolvedRoot = path.resolve(root) + path.sep;
  return candidate.startsWith(resolvedRoot) ? candidate : null;
}
