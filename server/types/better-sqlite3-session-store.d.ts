declare module "better-sqlite3-session-store" {
  import session from "express-session";
  function SqliteStoreFactory(session: typeof import("express-session")): {
    new (options: {
      client: import("better-sqlite3").Database;
      expired?: { clear?: boolean; intervalMs?: number };
    }): session.Store;
  };
  export default SqliteStoreFactory;
}
