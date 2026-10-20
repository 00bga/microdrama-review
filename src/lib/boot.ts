// Runs once per server start from instrumentation.ts (never during next build).
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getDb, schema } from "@/db";
import { UPLOADS_DIR } from "@/lib/uploads";

export function boot(): void {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  const db = getDb();
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  // A job that was running when the previous process died can never finish.
  const reset = db
    .update(schema.versions)
    .set({
      aiStatus: "error",
      aiStage: null,
      aiRunId: null,
      aiFinishedAt: Date.now(),
      aiError: "Interrupted by a server restart, run again",
    })
    .where(eq(schema.versions.aiStatus, "running"))
    .run();
  if (reset.changes > 0) {
    console.log(`[boot] marked ${reset.changes} interrupted AI job(s) as error`);
  }
}
