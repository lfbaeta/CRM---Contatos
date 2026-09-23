import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const password = randomBytes(24).toString('hex');
const token = randomBytes(32).toString('hex');
try {
  await writeFile('.env', `HOST=127.0.0.1\nPORT=3000\nPOSTGRES_USER=crm\nPOSTGRES_DB=crm_contatos\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://crm:${password}@127.0.0.1:5433/crm_contatos?sslmode=disable\nCRM_API_TOKEN=${token}\n`, { flag: 'wx', mode: 0o600 });
  console.log('.env criado com senha e token aleatórios. Próximo: docker compose up -d db');
  console.log('O token está no arquivo .env, no campo CRM_API_TOKEN. Use-o em Configurar acesso.');
} catch (error) {
  if (error.code === 'EEXIST') { console.error('.env já existe; configuração preservada. Confira docs/TESTE-LOCAL.md.'); process.exitCode = 1; }
  else throw error;
}
