import { buildApp } from './app.js';
import { config } from './config/index.js';
import { runMigrations } from './db/migrate.js';
import { pool, waitForDatabase } from './db/pool.js';
import { seedSystemTemplates } from './modules/documents/templates.js';
import { ensureMediaDir } from './modules/media/storage.js';

async function main(): Promise<void> {
  const app = await buildApp();

  // Wait for Postgres (readiness, not a fixed sleep), then apply migrations so a
  // clean database is usable on first boot.
  await waitForDatabase();
  const applied = await runMigrations();
  app.log.info(
    applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database schema up to date',
  );

  // Seed the product-provided system templates (idempotent). Kept out of buildApp so
  // it never runs during app.inject() unit tests; integration tests that need
  // templates seed explicitly. See modules/documents/templates.ts.
  await seedSystemTemplates();
  app.log.info('System templates ready');

  // Ensure the media object-storage root exists before serving uploads (ADR 0012).
  await ensureMediaDir(config.media.dir);
  app.log.info(`Media storage ready at ${config.media.dir}`);

  await app.listen({ host: '0.0.0.0', port: config.port });

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
