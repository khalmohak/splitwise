import { AppDataSource } from "../data-source";

export const queryRows = async <T>(sql: string, params: unknown[]): Promise<T[]> =>
  AppDataSource.query(sql, params);
