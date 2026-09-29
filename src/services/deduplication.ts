import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';

export async function sha256File(filepath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filepath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function removeFile(filepath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.promises.rm(filepath, { force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EBUSY', 'EPERM'].includes(code || '') || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
