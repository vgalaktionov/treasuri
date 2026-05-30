import type { QueryConfig } from "pg";
import sql, { type Sql } from "sql-template-tag";

export { sql };

export function toQuery(sqlStatement: Sql): QueryConfig {
  return {
    text: sqlStatement.text,
    values: sqlStatement.values,
  };
}
