import { RawBuilder, sql } from "kysely";

export const sqlOrderByBM25Expr = (column: string, search: string): RawBuilder<string> => {
  const escaped_search = search.replace(/'/g, "''");
  return sql.raw(`${column} <@> '${escaped_search}'`);
};

export const sqlEmbeddingArray = (embedding: number[]): RawBuilder<number[]> => {
  return sql.raw(`ARRAY[${embedding.join(',')}]`);
};

export const sqlOrderByEmbeddingExpr = (column: string, embedding: number[]): RawBuilder<number[]> => {
  return sql.raw(`${column} <=> ${sqlEmbeddingArray(embedding)}::vector`);
};
