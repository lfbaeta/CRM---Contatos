import pg from "pg";
import { databaseUrl } from "./config.js";

const { Pool } = pg;
export const pool = new Pool({
  connectionString: databaseUrl(),
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
