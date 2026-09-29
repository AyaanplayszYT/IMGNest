import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { env } from '../config/env';
import { ensureStorageDirectories } from './storage';

const supportedFormats = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);

export interface ProcessedImage {
  filepath: string;
  width: number;
  height: number;
  size: number;
}

export async function processImage(inputPath: string): Promise<ProcessedImage> {
  ensureStorageDirectories();
  const outputPath = path.join(env.tempStoragePath, `${randomUUID()}.webp`);
  const image = sharp(inputPath, {
    failOn: 'error',
    sequentialRead: true,
    limitInputPixels: Math.max(20_000_000, env.maxImageWidth * env.maxImageHeight * 4)
  });
  try {
    const metadata = await image.metadata();
    if (!metadata.format || !supportedFormats.has(metadata.format)) throw new Error('Unsupported or invalid image format');
    if (!metadata.width || !metadata.height) throw new Error('Image dimensions are missing');
    const info = await image.rotate()
      .resize({ width: env.maxImageWidth, height: env.maxImageHeight, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toFile(outputPath);
    image.destroy();
    return { filepath: outputPath, width: info.width, height: info.height, size: info.size };
  } catch (error) {
    image.destroy();
    await fs.promises.rm(outputPath, { force: true });
    throw error;
  }
}
