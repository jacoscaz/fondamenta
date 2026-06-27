import path, { resolve } from 'path'
import fs from 'fs/promises'
import {
  Migrator,
  FileMigrationProvider
} from 'kysely/migration';
import { type DB, ensureNoTrx } from './client.js';
import { type Logger } from 'pinetto';

export const migrateToLatest = async (db: DB, logger: Logger) => {

  const migrator = new Migrator({
    db: ensureNoTrx(db),
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: resolve(import.meta.dirname, 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === 'Success') {
      logger.debug('migration %s was executed successfully', it.migrationName);
    } else if (it.status === 'Error') {
      logger.error('failed to execute migration %s', it.migrationName);
    }
  });

  if (error) {
    throw error;
  }

};
