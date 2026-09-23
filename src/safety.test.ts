import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearch } from './search.js';
import { validateContacts } from './validation.js';
import { apiToken, databaseUrl } from './config.js';
import { buildApp } from './server.js';
import type { Pool } from 'pg';

test('recusa configurações incompletas e token de exemplo', () => {
  assert.throws(() => databaseUrl('https://localhost/db'));
  assert.throws(() => databaseUrl('postgresql://user:password@host/db'));
  assert.throws(() => apiToken('troque-por-um-segredo-aleatorio-longo'));
  assert.equal(databaseUrl('postgresql://crm:senha@127.0.0.1:5433/crm'), 'postgresql://crm:senha@127.0.0.1:5433/crm');
});
test('busca parametrizada, acentos, telefone e filtros combinados', () => {
  const result = buildSearch({q:'Açaí',location:'Pariquera-Açu',category:'Lanches',status:'interessado',sort:'name',page:'2',pageSize:'25'});
  assert.deepEqual(result.params, ['interessado','%acai%','%pariquera-acu%','Lanches']);
  assert.equal(result.page,2);
  assert.equal(buildSearch({category:'Lanches',pageSize:'2000'}).pageSize,2000);
  assert.throws(() => buildSearch({pageSize:'2001'}));
  assert.ok(buildSearch({q:'(13) 99999-1234'}).params.includes('%13999991234%'));
  assert.ok(!buildSearch({q:"'; DROP TABLE contacts; --"}).where.includes('DROP'));
  assert.throws(() => buildSearch({sort:'name;DROP TABLE contacts'}));
  assert.throws(() => buildSearch({page:'1.5'}));
  assert.throws(() => buildSearch({q:[]}));
});
test('confirmação recalcula telefone e recusa valores que quebrariam o lote', () => {
  const contact = {name:' Loja ',phone_original:'(13) 99999-1234',phone_normalized:'alterado'};
  assert.equal(validateContacts([contact])[0].phone_normalized,'5513999991234');
  for(const patch of [{name:' '},{address:3},{rating:99},{ratings_count:1.5},{phone_original:'123'}]) {
    assert.throws(() => validateContacts([{...contact,...patch}]));
  }
});
test('API exige token antes de tocar o banco e rejeita importação malformada', async () => {
  let queries = 0;
  const pool = {query: async () => { queries++; throw new Error('Senha que não pode aparecer'); }} as unknown as Pool;
  const token = 'a'.repeat(64), app = await buildApp(pool,token);
  try {
    for(const url of ['/api/contacts','/api/filters','/api/health']) assert.equal((await app.inject({url})).statusCode,401);
    assert.equal(queries,0);
    const headers = {authorization:`Bearer ${token}`};
    const response = await app.inject({url:'/api/import/commit',method:'POST',headers,payload:{contacts:[{name:'Loja',phone_original:'123'}]}});
    assert.equal(response.statusCode,400); assert.equal(queries,0);
    const badId = await app.inject({url:'/api/contacts/'+'-'.repeat(36)+'/status',method:'PATCH',headers,payload:{status:'novo'}});
    assert.equal(badId.statusCode,400);
    const health = await app.inject({url:'/api/health',headers});
    assert.equal(health.statusCode,500); assert.ok(!health.body.includes('Senha'));
  } finally { await app.close(); }
});
