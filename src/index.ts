import { env } from './config/env';
import { buildServer } from './api/server';
import { ensureStorageDirectories } from './services/storage';
import { startScheduler } from './workers/scheduler';
import fs from 'node:fs';
import path from 'node:path';

const RESET  = '\x1b[0m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';

function printBanner(): void {
  const asciiPath = path.resolve(process.cwd(), 'ascii.txt');
  let art = '';
  try {
    art = fs.readFileSync(asciiPath, 'utf8');
  } catch {
    // ascii.txt missing — skip silently
  }

  const sep = `${DIM}${'─'.repeat(75)}${RESET}`;

  if (art) {
    process.stdout.write(`\n${CYAN}${art}${RESET}`);
  }

  process.stdout.write(`${sep}\n`);
  process.stdout.write(
    `  ${BOLD}IMGNest${RESET}  ` +
    `${DIM}v1.0.0${RESET}  ` +
    `${YELLOW}${env.nodeEnv.toUpperCase()}${RESET}\n`
  );
  process.stdout.write(`${sep}\n\n`);
}

async function main(): Promise<void> {
  printBanner();
  ensureStorageDirectories();
  const app = await buildServer();
  try {
    await app.listen({ port: env.port, host: env.host });
    console.log(`  ${GREEN}ready${RESET}   http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${env.port}`);
    console.log(`  ${DIM}health  http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${env.port}/api/health${RESET}`);
    startScheduler();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
    await app.close();
  }
}

void main();
