import postgres from "postgres";

// Direct SQL access to the database (server only; it bypasses RLS like a service key).
// On Vercel the Supabase integration provides POSTGRES_URL (pooled). Locally we build a
// direct URL from SUPABASE_DB_PASSWORD, or use DATABASE_URL if set.

const PROJECT_REF = "ugfvzcbkqnhtejgcqhsb";

// The Vercel integration's URLs carry extra query parameters (sslmode, supa=...). The driver
// would forward unknown ones to the server as connection settings, which the pooler can reject,
// so keep only scheme, credentials, host, port and database. TLS is requested separately.
export function cleanConnectionString(url: string): string {
  const parsed = new URL(url);
  parsed.search = "";
  return parsed.toString();
}

export function connectionString(): string {
  const explicit = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (explicit) return cleanConnectionString(explicit);
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) throw new Error("Database credentials are not configured");
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

export type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { __subsyncSql?: Sql };

export function sql(): Sql {
  if (!globalForDb.__subsyncSql) {
    globalForDb.__subsyncSql = postgres(connectionString(), {
      // The pooler runs in transaction mode, which does not support prepared statements.
      prepare: false,
      // DB_POOL_MAX lets a deployment (or a dev server on a slow link) allow more parallel statements; the default stays 5.
      max: Math.min(20, Math.max(1, Number(process.env.DB_POOL_MAX) || 5)),
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: "require",
      onnotice: () => {},
    });
  }
  return globalForDb.__subsyncSql;
}

export async function closeDb(): Promise<void> {
  if (globalForDb.__subsyncSql) {
    await globalForDb.__subsyncSql.end({ timeout: 5 });
    globalForDb.__subsyncSql = undefined;
  }
}
