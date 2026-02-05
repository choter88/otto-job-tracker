import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.OTTO_SQLITE_PATH ? `file:${process.env.OTTO_SQLITE_PATH}` : "file:./.otto-data/dev.sqlite",
  },
});
