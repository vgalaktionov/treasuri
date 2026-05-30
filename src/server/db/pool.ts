import pg from "pg";

export type Database = pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
  });
}

export async function withPool<T>(
  connectionString: string,
  callback: (pool: pg.Pool) => Promise<T>,
): Promise<T> {
  const pool = createPool(connectionString);

  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}
