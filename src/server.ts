import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { createHash, timingSafeEqual } from "node:crypto";
import { apiToken } from "./config.js";
import { buildSearch } from "./search.js";
import { validateContacts } from "./validation.js";
import { CONTACT_STATUSES, readWorkbook, type ContactStatus, type ImportedContact } from "./importer.js";

export async function buildApp(pool: Pool, token = apiToken()) {
const app = Fastify({ logger: { redact: ['req.headers.authorization'] }, bodyLimit: 12 * 1024 * 1024 });
app.setErrorHandler((caught, request, reply) => {
  const error = caught as { statusCode?: number; code?: string };
  const code = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
  request.log.error({ code: error.code }, 'Falha na operação');
  reply.code(code).send({ error: code === 413 ? 'Arquivo ou lista acima do limite permitido.' : code < 500 ? 'Dados inválidos. Confira os campos e tente novamente.' : 'Não foi possível acessar os dados. Confira o banco e execute a migração.' });
});
app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
  return payload;
});

await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile("public/index.html")));
app.get("/app.js", async (_request, reply) => reply.type("text/javascript; charset=utf-8").send(await readFile("public/app.js")));
app.get("/styles.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(await readFile("public/styles.css")));

app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/api/")) return;
  const authorization = request.headers.authorization ?? "";
  if (!timingSafeEqual(createHash("sha256").update(authorization).digest(), createHash("sha256").update(`Bearer ${token}`).digest())) return reply.code(401).send({ error: "Acesso não autorizado." });
});

app.get("/api/health", async () => {
  await pool.query("SELECT id, notes FROM contacts LIMIT 0");
  return { ok: true };
});

app.get('/api/filters', async () => {
  const result = await pool.query("SELECT DISTINCT category FROM contacts WHERE category IS NOT NULL AND category <> '' ORDER BY category");
  return { categories: result.rows.map(row => row.category) };
});
app.get<{ Querystring: Record<string, unknown> }>('/api/contacts', async (request, reply) => {
  let search;
  try { search = buildSearch(request.query); }
  catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  const { where, params, order, page, pageSize } = search;
  const count = await pool.query(`SELECT count(*)::int AS total FROM contacts ${where}`, params);
  const result = await pool.query(
    `SELECT id,name,address,phone_original,phone_normalized,email,rating,ratings_count,website,whatsapp,contact_status,category,notes,created_at,updated_at
     FROM contacts ${where} ORDER BY ${order}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]);
  const summary = await pool.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE contact_status = 'interessado')::int AS interessado,
    count(*) FILTER (WHERE contact_status = 'nao_respondeu')::int AS nao_respondeu,
    count(*) FILTER (WHERE contact_status = 'convertido')::int AS convertido FROM contacts`);
  return { contacts: result.rows, summary: summary.rows[0], total: count.rows[0].total, page, pageSize };
});
app.patch<{ Params: { id: string }; Body: { notes: string } }>('/api/contacts/:id/notes', async (request, reply) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id) || typeof request.body?.notes !== 'string' || request.body.notes.length > 5000) {
    return reply.code(400).send({ error: 'Observação inválida (máximo de 5.000 caracteres).' });
  }
  const result = await pool.query('UPDATE contacts SET notes=$1, updated_at=now() WHERE id=$2 RETURNING id,notes', [request.body.notes.trim() || null, request.params.id]);
  if (!result.rowCount) return reply.code(404).send({ error: 'Contato não encontrado.' });
  return result.rows[0];
});

app.patch<{ Params: { id: string }; Body: { status: ContactStatus } }>("/api/contacts/:id/status", async (request, reply) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id) || !CONTACT_STATUSES.includes(request.body?.status)) {
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
  const valid = rows.flatMap(row => {
    try { return validateContacts([row]); } catch { return []; }
  });
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
    alreadyRegistered: firstOccurrences.filter((row) => existingPhones.has(row.phone_normalized!)).length,
    ready,
  };
});

app.post<{ Body: { contacts: ImportedContact[] } }>("/api/import/commit", async (request, reply) => {
  const contacts = request.body?.contacts;
  if (!Array.isArray(contacts) || contacts.length === 0 || contacts.length > 10_000) {
    return reply.code(400).send({ error: "Selecione registros válidos para importar." });
  }
  let payload;
  try { payload = validateContacts(contacts); }
  catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
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

return app;
}
