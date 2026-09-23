# Testar no computador (Windows)

## Opção automática: PostgreSQL local pelo Docker Desktop

Requer Git, Node.js 22 LTS e Docker Desktop instalado e iniciado. O banco e seus dados ficam no computador.

No PowerShell:

```powershell
git clone --branch feature/importacao-status-contatos https://github.com/lfbaeta/CRM---Contatos.git
cd CRM---Contatos
npm ci
npm run setup:local
docker compose up -d db
docker compose ps
npm run build
npm run migrate
npm start
```

Se o repositório já estiver clonado, entre na pasta, salve suas alterações e use `git switch feature/importacao-status-contatos` e `git pull --ff-only`.

Aguarde o banco aparecer como `healthy` antes da migração. Abra http://localhost:3000. Abra `.env` com o Bloco de Notas e copie somente o valor de `CRM_API_TOKEN` para **Configurar acesso**. O campo fica oculto e o token é guardado na sessão da aba. **Sair** remove o acesso e limpa os contatos exibidos.

`npm run setup:local` gera senha de banco e token aleatórios; não sobrescreve `.env` existente. A porta 5433 evita o conflito habitual com PostgreSQL instalado na porta 5432. A API e o banco aceitam conexões apenas do próprio computador nesta configuração.

## Se já tem PostgreSQL instalado, sem Docker

1. Use PostgreSQL 14 ou superior. No pgAdmin, crie um usuário próprio (por exemplo, `crm`) com senha e um banco vazio `crm_contatos` de propriedade desse usuário.
2. Execute `npm ci` e `npm run setup:local` na pasta do projeto.
3. Edite somente `DATABASE_URL` no `.env` para refletir o banco criado:

```dotenv
DATABASE_URL=postgresql://crm:SENHA_CODIFICADA@127.0.0.1:5432/crm_contatos?sslmode=disable
```

Caracteres especiais na senha precisam de codificação de URL (por exemplo, `@` vira `%40`). As variáveis `POSTGRES_*` são usadas apenas pelo Docker e não criam usuário ou banco em uma instalação existente. Preserve o `CRM_API_TOKEN` aleatório gerado.

4. Execute `npm run build`, `npm run migrate` e `npm start`.

## Roteiro de conferência

- Conectar com token incorreto deve recusar o acesso; com o correto deve carregar a base.
- Importar uma planilha pequena de teste, conferir a prévia e confirmar. O status inicial deve ser Novo.
- Reimportar a mesma planilha: não deve duplicar nem sobrescrever status ou observações.
- Buscar sem acentos (ex.: `acai` encontra `Açaí`) e por telefone sem parênteses/hífens.
- Combinar cidade/bairro/rua do endereço, categoria e status. Usar Limpar filtros.
- Alterar cada um dos cinco status, salvar observação e procurar um trecho dela na busca.
- Filtrar uma categoria: todos os resultados da categoria aparecem na mesma tela (até 2.000); os botões de página somem quando não há outra página. Sem categoria, escolha 10, 25, 50 ou 100 itens por página; use Anterior/Próxima para percorrer todos os resultados.
- Abrir WhatsApp e mapa: são atalhos; não enviam mensagens automaticamente. O mapa faz uma pesquisa por nome e endereço.
- Reiniciar o servidor e confirmar que os registros persistem.

Localização usa o texto de Endereço. A precisão depende da planilha; não há geolocalização nem busca de empresas externas. As categorias vêm da própria base. Os indicadores do topo representam toda a base; a contagem abaixo representa os filtros atuais. Observações são um texto editável, não um histórico de auditoria.

## Parar e voltar

Use Ctrl+C para parar o CRM. `docker compose stop db` para parar o banco; `docker compose start db` e `npm start` para voltar. O volume `crm_postgres` preserva os dados. `docker compose down -v` apaga esse volume; não o use para parar normalmente.

## Problemas comuns

- **Conexão recusada:** banco parado ou host/porta incorretos. Confira `docker compose ps` ou o serviço PostgreSQL.
- **Senha recusada:** confira DATABASE_URL. Mudar POSTGRES_PASSWORD no `.env` não altera a senha de um banco já criado no volume.
- **Tabela ausente:** execute `npm run migrate` no banco correto. A migração pode ser repetida; não apaga contatos.
- **Porta 3000 ocupada:** altere PORT no `.env` e abra a mesma porta no navegador.
- **Token recusado:** copie o valor inteiro de CRM_API_TOKEN sem espaços; reinicie o servidor após editar `.env`.
- **Planilha recusada:** arquivo .xlsx, primeira aba com Nome e Telefone, até 10.000 linhas e 5 MB. Nome até 200 caracteres, nota entre 0 e 5 e avaliações como inteiro não negativo.

DATABASE_URL é a conexão privada do servidor ao banco. CRM_API_TOKEN é a chave de acesso ao CRM, criada localmente; não é um token de GitHub ou de PostgreSQL. Nunca coloque `.env` no GitHub. Para publicação futura, será necessário HTTPS e uma configuração própria de hospedagem; `sslmode=disable` é apenas para o banco local.
