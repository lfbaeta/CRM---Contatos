import { readFile } from "node:fs/promises";
import { pool } from "./db.js";

try {
  const sql = await readFile(new URL("../db/migrations/001_contacts.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("Migração aplicada.");
} finally {
  await pool.end();
}
