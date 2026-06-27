
import type { Tables } from './tables.js';

import { IsolationLevel, Kysely, sql, Transaction } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { Config } from '../config/config.js';
import postgres from 'postgres';

export { sql };

export type DB = Kysely<Tables> | Transaction<Tables>;

export const getDB = (opts: Config): DB => {
  const dialect_client = postgres({
    database: opts.postgres.database,
    username: opts.postgres.username,
    password: opts.postgres.password,
    hostname: opts.postgres.hostname,
    port: opts.postgres.port,
    types: {
      timestamp: {
        to: 1114,
        from: [1114],
        serialize: (v: string) => v,
        parse: (v: string) => v,
      },
      timestamptz: {
        to: 1184,
        from: [1184],
        serialize: (v: Date) => v.toISOString(),
        parse: (v: string) => new Date(v),
      },
      jsonb: {
        to: 3802,
        from: [3802],
        serialize: (v: any) => JSON.stringify(v),
        parse: (v: string) => JSON.parse(v),
      },
      json: {
        to: 114,
        from: [114],
        serialize: (v: any) => JSON.stringify(v),
        parse: (v: string) => JSON.parse(v),
      },
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: number) => {
          if (v < Number.MIN_SAFE_INTEGER || v > Number.MAX_SAFE_INTEGER) {
            throw new Error(`Value ${v} out of range for the number type`);
          }
          return v.toString();
        },
        parse: (v: string) => {
          const raw = BigInt(v);
          if (raw < Number.MIN_SAFE_INTEGER || raw > Number.MAX_SAFE_INTEGER) {
            throw new Error(`Value ${v} out of range for the number type`);
          }
          return Number(raw);
        },
      },
    },
  });
  const db = new Kysely<Tables>({
    dialect: new PostgresJSDialect({
      postgres: dialect_client,
    }),
    // log: ['query', 'error'],
  });
  return db;
};

export const isTrx = (db: DB): db is Transaction<Tables> => {
  return db instanceof Transaction;
};

export const ensureNoTrx = (db: DB): Kysely<Tables> => {
  if (isTrx(db)) {
    throw new Error('transaction');
  }
  return db;
};

export const ensureTrx = async <T>(db: DB, callback: (trx: Transaction<Tables>) => Promise<T>, isolationLevel?: IsolationLevel): Promise<T> => {
  if (isTrx(db)) {
    return await callback(db);
  }
  let trx = db.transaction();
  if (isolationLevel) {
    trx = trx.setIsolationLevel(isolationLevel);
  }
  return await trx.execute(callback);
};
