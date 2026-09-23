import ExcelJS from "exceljs";

export const CONTACT_STATUSES = [
  "novo",
  "interessado",
  "nao_respondeu",
  "sem_interesse",
  "convertido",
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export type ImportedContact = {
  name: string;
  address: string | null;
  phone_original: string | null;
  phone_normalized: string | null;
  email: string | null;
  rating: number | null;
  ratings_count: number | null;
  website: string | null;
  whatsapp: string | null;
  category: string | null;
  types: string | null;
  source_export_date: string | null;
  source_export_time: string | null;
};

const aliases: Record<keyof ImportedContact, string[]> = {
  name: ["nome", "empresa", "estabelecimento", "name"],
  address: ["endereco", "address"],
  phone_original: ["telefone", "phone", "telefone principal"],
  phone_normalized: [],
  email: ["e-mail", "email", "e mail"],
  rating: ["rating", "nota", "avaliacao", "avaliação"],
  ratings_count: ["avaliacoes", "avaliações", "quantidade de avaliações", "reviews"],
  website: ["website", "site", "url"],
  whatsapp: ["whatsapp", "whats app"],
  category: ["categoria", "category"],
  types: ["tipos", "types"],
  source_export_date: ["data exportacao", "data_exportacao", "data de exportação"],
  source_export_time: ["hora exportacao", "hora_exportacao", "hora de exportação"],
};

const clean = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return !text || /^(não informado|nao informado|não verificado|nao verificado)$/i.test(text) ? null : text;
};

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 15) return null;
  return digits;
}

export function mapRows(headers: unknown[], rawRows: unknown[][]): ImportedContact[] {
  const normalized = headers.map(normalizeHeader);
  const indexes = Object.fromEntries(
    (Object.keys(aliases) as (keyof ImportedContact)[]).map((key) => [
      key,
      aliases[key].map(normalizeHeader).map((alias) => normalized.indexOf(alias)).find((index) => index >= 0) ?? -1,
    ]),
  ) as Record<keyof ImportedContact, number>;

  return rawRows.map((row) => {
    const get = (key: keyof ImportedContact) => indexes[key] < 0 ? null : clean(row[indexes[key]]);
    const phone = get("phone_original");
    const ratingText = get("rating");
    const countText = get("ratings_count");
    const rating = ratingText ? Number(ratingText.replace(",", ".")) : NaN;
    const ratingsCount = countText ? Number(countText.replace(/\D/g, "")) : NaN;
    return {
      name: get("name") ?? "",
      address: get("address"),
      phone_original: phone,
      phone_normalized: normalizePhone(phone),
      email: get("email"),
      rating: Number.isFinite(rating) ? rating : null,
      ratings_count: Number.isFinite(ratingsCount) ? ratingsCount : null,
      website: get("website"),
      whatsapp: get("whatsapp") ?? phone,
      category: get("category"),
      types: get("types"),
      source_export_date: get("source_export_date"),
      source_export_time: get("source_export_time"),
    };
  }).filter((row) => row.name || row.phone_original || row.email || row.address);
}

export async function readWorkbook(buffer: Buffer): Promise<ImportedContact[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error("A planilha não tem linhas de contatos.");
  if (sheet.rowCount > 10001 || sheet.columnCount > 100) {
    throw new Error("A planilha ultrapassa o limite de 10.000 linhas ou 100 colunas.");
  }
  const headers = sheet.getRow(1).values as unknown[];
  const headerCells = headers.slice(1);
  const rawRows: unknown[][] = [];
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    rawRows.push(Array.from({ length: sheet.columnCount }, (_, i) => {
      const value = row.getCell(i + 1).value;
      if (value && typeof value === "object" && "text" in value) return value.text;
      if (value instanceof Date) return value.toISOString();
      return value;
    }));
  }
  const contacts = mapRows(headerCells, rawRows);
  if (!headerCells.some((header) => aliases.name.includes(normalizeHeader(header)))) {
    throw new Error("Não encontrei a coluna Nome/Empresa na primeira linha.");
  }
  return contacts;
}

export function validForImport(contact: ImportedContact): boolean {
  return contact.name.length > 0 && Boolean(contact.phone_normalized);
}
