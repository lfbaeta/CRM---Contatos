export function databaseUrl(value = process.env.DATABASE_URL): string {
  if (!value) throw new Error('Configure DATABASE_URL no arquivo .env.');
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hostname === 'host' || url.pathname.length < 2) throw new Error();
  } catch { throw new Error('DATABASE_URL inválida. Use a URL de conexão PostgreSQL, com usuário, senha, host, porta e banco.'); }
  return value;
}
export function apiToken(value = process.env.CRM_API_TOKEN): string {
  if (!value || value.trim() !== value || value.length < 32 || /troque|exemplo|secret|change/i.test(value)) {
    throw new Error('Configure CRM_API_TOKEN aleatório com pelo menos 32 caracteres. Use npm run setup:local.');
  }
  return value;
}
