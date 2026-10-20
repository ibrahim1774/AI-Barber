/** Jest stand-in for expo-sqlite. Unit tests never open a real database. */
export type SQLiteBindValue = string | number | null | boolean | Uint8Array;
export class SQLiteDatabase {
  execAsync = async (_sql: string) => {};
  runAsync = async (..._args: unknown[]) => ({ changes: 0, lastInsertRowId: 0 });
  getFirstAsync = async <T,>(..._args: unknown[]): Promise<T | null> => null;
  getAllAsync = async <T,>(..._args: unknown[]): Promise<T[]> => [];
}
export const openDatabaseAsync = async (_name: string) => new SQLiteDatabase();
