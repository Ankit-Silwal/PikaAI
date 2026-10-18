export interface Database {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}
