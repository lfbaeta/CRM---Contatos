import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
import { CONTACT_STATUSES, readWorkbook, validForImport, type ContactStatus, type ImportedContact } from "./importer.js";

const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
const token = process.env.CRM_API_TOKEN;
if (!process.env.DATABASE_URL || !token || token.length < 24) {
  throw new Error("Configure DATABASE_URL e CRM_API_TOKEN (com pelo menos 24 caracteres).");
}

await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile("public/index.html")));
app.get("/app.js", async (_request, reply) => reply.type("text/javascript; charset=utf-8").send(await readFile("public/app.js")));
app.get("/styles.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(await readFile("public/styles.css")));

app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/api/")) return;
  const authorization = request.headers.authorization ?? "";
  if (authorization !== `Bearer ${token}`) return reply.code(401).send({ error: "Acesso não autorizado." });
});

app.get("/api/health", async () => {
  await pool.query("SELECT 1");
  return { ok: true };
});

app.get<{ Querystring: { q?: string; status?: string; limit?: string } }>("/api/contacts", async (request, reply) => {
  const q = (request.query.q ?? "").trim().slice(0, 120);
  const status = request.query.status ?? "todos";
  const limit = Math.min(Math.max(Number(request.query.limit) || 500, 1), 2000);
  if (status !== "todos" && !CONTACT_STATUSES.includes(status as ContactStatus)) {
    return reply.code(400).send({ error: "Status inválido." });
  }
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (status !== "todos") { params.push(status); clauses.push(`contact_status = $${params.length}`); }
  if (q) { params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`); clauses.push(`(name ILIKE $${params.length} OR phone_original ILIKE $${params.length} OR address ILIKE $${params.length})`); }
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT id, name, address, phone_original, email, rating, ratings_count, website, whatsapp, contact_status, category, created_at FROM contacts ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  const summary = await pool.query(
    `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE contact_status = 'interessado')::int AS interessado,
      count(*) FILTER (WHERE contact_status = 'nao_respondeu')::int AS nao_respondeu,
      count(*) FILTER (WHERE contact_status = 'convertido')::int AS convertido
     FROM contacts`,
  );
  return { contacts: result.rows, summary: summary.rows[0] };
});

app.patch<{ Params: { id: string }; Body: { status: ContactStatus } }>("/api/contacts/:id/status", async (request, reply) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.id) || !CONTACT_STATUSES.includes(request.body?.status)) {
    return reply.code(400).send({ error: "Contato ou status inválido." });
  }
  const result = await pool.query(
    "UPDATE contacts SET contact_status = $1, updated_at = now() WHERE id = $2 RETURNING id, contact_status",
    [request.body.status, request.params.id],
  );
  if (!result.rowCount) return reply.code(404).send({ error: "Contato não encontrado." });
  return result.rows[0];
});

app.post("/api/import/preview", async (request, reply) => {
  const file = await request.file();
  if (!file || !file.filename.toLowerCase().endsWith(".xlsx")) {
    return reply.code(400).send({ error: "Envie um arquivo .xlsx." });
  }
  let rows: ImportedContact[];
  try { rows = await readWorkbook(await file.toBuffer()); }
  catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Não foi possível ler a planilha." }); }
  if (!rows.length) return reply.code(400).send({ error: "Nenhum registro foi encontrado." });
  const valid = rows.filter(validForImport);
  const invalid = rows.length - valid.length;
  const seen = new Set<string>();
  let duplicateInFile = 0;
  const firstOccurrences = valid.filter((row) => {
    const phone = row.phone_normalized!;
    if (seen.has(phone)) { duplicateInFile += 1; return false; }
    seen.add(phone);
    return true;
  });
  const phones = [...new Set(valid.map((row) => row.phone_normalized).filter(Boolean))];
  const existing = phones.length ? await pool.query(
    "SELECT phone_normalized FROM contacts WHERE phone_normalized = ANY($1::text[])", [phones],
  ) : { rows: [] as { phone_normalized: string }[] };
  const existingPhones = new Set(existing.rows.map((row) => row.phone_normalized));
  const ready = firstOccurrences.filter((row) => !existingPhones.has(row.phone_normalized!));
  return {
    total: rows.length,
    valid: valid.length,
    invalid,
    duplicatesInFile: duplicateInFile,
    alreadyRegistered: valid.filter((row) => existingPhones.has(row.phone_normalized!)).length,
    ready,
  };
});

app.post<{ Body: { contacts: ImportedContact[] } }>("/api/import/commit", async (request, reply) => {
  const contacts = request.body?.contacts;
  if (!Array.isArray(contacts) || contacts.length === 0 || contacts.length > 10_000) {
    return reply.code(400).send({ error: "Selecione registros válidos para importar." });
  }
  const normalized = contacts.filter((item) => item && typeof item.name === "string" && validForImport(item));
  if (normalized.length !== contacts.length) return reply.code(400).send({ error: "A lista contém contatos inválidos." });
  const payload = normalized.map((c) => ({
    name: c.name.slice(0, 200), address: c.address?.slice(0, 500) ?? null,
    phone_original: c.phone_original?.slice(0, 40) ?? null, phone_normalized: c.phone_normalized,
    email: c.email?.slice(0, 254) ?? null, rating: c.rating, ratings_count: c.ratings_count,
    website: c.website?.slice(0, 500) ?? null, whatsapp: c.whatsapp?.slice(0, 40) ?? null,
    category: c.category?.slice(0, 160) ?? null, types: c.types?.slice(0, 500) ?? null,
    source_export_date: c.source_export_date?.slice(0, 40) ?? null, source_export_time: c.source_export_time?.slice(0, 40) ?? null,
  }));
  const result = await pool.query(
    `INSERT INTO contacts (name,address,phone_original,phone_normalized,email,rating,ratings_count,website,whatsapp,category,types,source_export_date,source_export_time)
     SELECT name,address,phone_original,phone_normalized,email,rating,ratings_count,website,whatsapp,category,types,source_export_date,source_export_time
     FROM jsonb_to_recordset($1::jsonb) AS x(name text,address text,phone_original text,phone_normalized text,email text,rating numeric,ratings_count integer,website text,whatsapp text,category text,types text,source_export_date text,source_export_time text)
     ON CONFLICT (phone_normalized) WHERE phone_normalized IS NOT NULL AND phone_normalized <> '' DO NOTHING
     RETURNING id`, [JSON.stringify(payload)],
  );
  return { imported: result.rowCount ?? 0, skippedAsDuplicate: payload.length - (result.rowCount ?? 0) };
});

app.get("/api/statuses", async () => ({ statuses: CONTACT_STATUSES }));

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
}
