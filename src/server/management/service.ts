import type pg from "pg";

export async function listCategories(pool: pg.Pool) {
  const result = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM categories ORDER BY name",
  );
  return result.rows.map((row) => ({ id: Number(row.id), name: row.name }));
}
