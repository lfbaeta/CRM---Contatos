import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { buildApp } from './server.js';

test('PostgreSQL: migração, XLSX, duplicados, busca, status, observações e páginas', {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const schema = `crm_test_${Date.now()}`;
  const admin = new pg.Pool({connectionString: process.env.TEST_DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({connectionString: process.env.TEST_DATABASE_URL, options:`-c search_path=${schema}`});
  const token = 'b'.repeat(64), headers = {authorization:`Bearer ${token}`};
  const app = await buildApp(pool,token);
  try {
    const sql = await readFile(new URL('../db/migrations/001_contacts.sql',import.meta.url),'utf8');
    await pool.query(sql); await pool.query(sql);
    assert.equal((await app.inject({url:'/api/health',headers})).statusCode,200);
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Empresas');
    sheet.addRow(['Nome','Telefone','Endereço','Categoria','Rating']);
    sheet.addRow(['Açaí Teste','(13) 99999-1234','Centro, Pariquera-Açu','Lanches',4.5]);
    sheet.addRow(['Duplicado','(13) 99999-1234','Centro','Lanches',4]);
    sheet.addRow(['Inválido','123','Centro','Lanches',3]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const boundary = 'crm-test-boundary';
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="empresas.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const preview = async () => app.inject({url:'/api/import/preview',method:'POST',headers:{...headers,'content-type':`multipart/form-data; boundary=${boundary}`},payload});
    const first = (await preview()).json();
    assert.equal(first.total,3); assert.equal(first.invalid,1); assert.equal(first.duplicatesInFile,1); assert.equal(first.ready.length,1);
    const commit = async (contacts: unknown[]) => app.inject({url:'/api/import/commit',method:'POST',headers,payload:{contacts}});
    assert.equal((await commit(first.ready)).json().imported,1);
    assert.equal((await commit(first.ready)).json().imported,0);
    const second = (await preview()).json(); assert.equal(second.alreadyRegistered,1); assert.equal(second.ready.length,0);
    const list = async (q='') => (await app.inject({url:'/api/contacts?'+q,headers})).json();
    const found = await list('q=acai&location=pariquera-acu&category=Lanches'); assert.equal(found.total,1);
    const id = found.contacts[0].id; assert.equal(found.contacts[0].contact_status,'novo');
    assert.equal((await list('q=13999991234')).total,1);
    for(const status of ['novo','interessado','nao_respondeu','sem_interesse','convertido']) {
      assert.equal((await app.inject({url:`/api/contacts/${id}/status`,method:'PATCH',headers,payload:{status}})).statusCode,200);
      assert.equal((await list('status='+status)).total,1);
    }
    assert.equal((await app.inject({url:`/api/contacts/${id}/notes`,method:'PATCH',headers,payload:{notes:'Retornar na próxima terça'}})).statusCode,200);
    assert.equal((await list('q=terca')).total,1);
    assert.equal((await app.inject({url:'/api/filters',headers})).json().categories[0],'Lanches');
    const more = Array.from({length:52}, (_,i) => ({name:`Loja ${String(i).padStart(2,'0')}`,phone_original:`1398888${String(i).padStart(4,'0')}`}));
    assert.equal((await commit(more)).json().imported,52);
    assert.equal((await list('page=1&pageSize=10')).contacts.length,10);
    assert.equal((await list('page=2&pageSize=10')).contacts.length,10);
    assert.equal((await list('page=6&pageSize=10')).contacts.length,3);
    assert.equal((await list('page=1&pageSize=50')).contacts.length,50);
    assert.equal((await list('page=2&pageSize=50')).contacts.length,3);
    assert.equal((await list('q=%25')).total,0);
    assert.equal((await list('q='+encodeURIComponent("'; DROP TABLE contacts; --"))).total,0);
  } finally { await app.close(); await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
