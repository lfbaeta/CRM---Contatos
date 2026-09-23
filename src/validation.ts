import { normalizePhone, type ImportedContact } from './importer.js';
export function validateContacts(contacts: unknown[]): ImportedContact[] {
  return contacts.map((value, index) => {
    const fail = () => { throw new Error(`Contato ${index + 1} inválido. Confira nome, telefone e valores da planilha.`); };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    const c = value as Record<string, unknown>;
    const text = (key: string, max: number): string | null => {
      const v = c[key];
      if (v === undefined || v === null || v === '') return null;
      if (typeof v !== 'string' || v.length > max) return fail();
      return v.trim() || null;
    };
    const name = text('name', 200), phone = text('phone_original', 40);
    const normalized = normalizePhone(phone);
    if (!name || !normalized) return fail();
    const number = (key: string, max: number, integer = false) => {
      const v = c[key];
      if (v === null || v === undefined) return null;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max || (integer && !Number.isInteger(v))) return fail();
      return v;
    };
    return { name, phone_original: phone, phone_normalized: normalized,
      address: text('address', 500), email: text('email',254), rating: number('rating',5),
      ratings_count: number('ratings_count',2147483647,true), website: text('website',500),
      whatsapp: text('whatsapp',40), category: text('category',160), types: text('types',500),
      source_export_date: text('source_export_date',40), source_export_time: text('source_export_time',40) };
  });
}
