import { CONTACT_STATUSES, type ContactStatus } from './importer.js';
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const sqlFold = (column: string) => `translate(lower(coalesce(${column},'')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
const pattern = (s: string) => `%${fold(s).replace(/[\\%_]/g, '\\$&')}%`;
export function buildSearch(query: Record<string, unknown>) {
  const get = (key: string, max = 160) => {
    const value = query[key] ?? '';
    if (typeof value !== 'string' || value.length > max) throw new Error('Filtro inválido.');
    return value.trim();
  };
  const status = get('status') || 'todos';
  if (status !== 'todos' && !CONTACT_STATUSES.includes(status as ContactStatus)) throw new Error('Status inválido.');
  const page = Number(get('page') || 1), pageSize = Number(get('pageSize') || 50);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || ![25, 50, 100, 2000].includes(pageSize)) throw new Error('Página inválida.');
  const params: unknown[] = [], clauses: string[] = [];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (status !== 'todos') clauses.push(`contact_status = ${bind(status)}`);
  const q = get('q');
  if (q) {
    const p = bind(pattern(q));
    const fields = ['name','address','category','email','notes','phone_original'];
    const conditions = fields.map(field => `${sqlFold(field)} LIKE ${p}`);
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3 && /^[\d\s()+.\-]+$/.test(q)) conditions.push(`phone_normalized LIKE ${bind(`%${digits}%`)}`);
    clauses.push(`(${conditions.join(' OR ')})`);
  }
  const location = get('location');
  if (location) clauses.push(`${sqlFold('address')} LIKE ${bind(pattern(location))}`);
  const category = get('category');
  if (category) clauses.push(`category = ${bind(category)}`);
  const orders: Record<string,string> = { recent: 'created_at DESC', name: 'lower(name) ASC', updated: 'updated_at DESC', rating: 'rating DESC NULLS LAST' };
  const sort = get('sort') || 'recent';
  if (!Object.hasOwn(orders, sort)) throw new Error('Ordenação inválida.');
  return { params, where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', order: orders[sort], page, pageSize };
}
