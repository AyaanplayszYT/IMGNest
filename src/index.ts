import { env } from './config/env';
import { buildServer } from './api/server';
import { ensureStorageDirectories } from './services/storage';

async function main(): Promise<void> {
  ensureStorageDirectories();
  const app = await buildServer();
  try {
    await app.listen({ port: env.port, host: env.host });
    console.log(`[API] IMGNest listening on ${env.host}:${env.port}`);
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
    await app.close();
  }
}

void main();
