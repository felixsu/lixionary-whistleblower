import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { SQL, Param } from "drizzle-orm";
export function createDb(url: string) {
  const connection = postgres(url, {
    max: 10,
    onnotice: () => {},
    connection: { TimeZone: "UTC", statement_timeout: 30000 },
  });
  return {
    db: drizzle(connection),
    close: () => connection.end({ timeout: 5 }),
  };
}
export type Db = ReturnType<typeof createDb>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export async function rows<
  T extends Record<string, unknown> = Record<string, unknown>,
>(db: Db | Tx, query: SQL): Promise<T[]> {
  return Array.from(await db.execute(normalizeDates(query))) as unknown as T[];
}

function normalizeDates(query: SQL): SQL {
  return new SQL(
    query.queryChunks.map((chunk) =>
      chunk instanceof Date
        ? new Param(chunk.toISOString())
        : chunk instanceof SQL
          ? normalizeDates(chunk)
          : chunk,
    ),
  );
}
