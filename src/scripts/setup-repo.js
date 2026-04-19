# Setup script for creating the target GitHub repo with a Next.js scaffold.
# Run: node src/scripts/setup-repo.js

import dotenv from 'dotenv';
dotenv.config();

import { ensureRepoExists, getRepoTree } from '../services/github.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Setup');

async function main() {
  log.info('Setting up target repository...');

  const isNew = await ensureRepoExists();

  if (isNew) {
    log.info('✅ New repository created and scaffolded!');
  } else {
    log.info('ℹ️  Repository already exists.');
  }

  const tree = await getRepoTree();
  log.info(`Repository has ${tree.length} files:`);
  tree.forEach((f) => log.info(`  📄 ${f}`));

  log.info('\nSetup complete! Your pipeline is ready to receive webhooks.');
}

main().catch((err) => {
  log.error(`Setup failed: ${err.message}`);
  process.exit(1);
});
