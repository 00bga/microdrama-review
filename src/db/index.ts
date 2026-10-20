// One SQLite handle per process, opened lazily. Migrations and boot work live in lib/boot.ts.
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { DATA_DIR, DB_PATH } from "@/lib/uploads";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const globalRef = globalThis as unknown as { __microdramaDb?: Db };

export function getDb(): Db {
  if (!globalRef.__microdramaDb) {
    mkdirSync(DATA_DIR, { recursive: true });
    const client = new Database(DB_PATH);
    client.pragma("journal_mode = WAL");
    client.pragma("foreign_keys = ON");
    client.pragma("busy_timeout = 5000");
    globalRef.__microdramaDb = drizzle(client, { schema });
  }
  return globalRef.__microdramaDb;
}

export { schema };
export type { CastMember, Episode, NewNote, Note, Series, Version } from "./schema";
