# CRM - Contatos

Primeira etapa do CRM: importar a planilha de empresas `.xlsx`, revisar inválidos e duplicados, pesquisar a base e atualizar o status do contato.

## O que já está incluído

- Importação da primeira aba da planilha, com as colunas `Nome`, `Endereço`, `Telefone`, `E-mail`, `Rating`, `Avaliações`, `Website`, `WhatsApp`, `Categoria`, `Tipos`, `Data_Exportacao` e `Hora_Exportacao`.
- Prévia antes de gravar, normalização de telefone brasileiro, detecção de repetidos e ignorar contatos sem nome ou telefone válido.
- PostgreSQL externo; planilha e dados não são gravados no GitHub.
- Status: **Novo**, **Interessado**, **Não respondeu**, **Sem interesse** e **Convertido**.
- API protegida por um token configurado somente no servidor. O token digitado no navegador fica na sessão atual.

## Executar

Requer Node.js 20+ e PostgreSQL 14+ (pode ser um PostgreSQL Supabase ou hospedado em outro provedor).

1. Copie `.env.example` para `.env` e configure `DATABASE_URL` e um `CRM_API_TOKEN` aleatório com pelo menos 24 caracteres.
2. Instale as dependências: `npm install`.
3. Aplique a tabela: `npm run migrate`.
4. Inicie: `npm start`.
5. Abra `http://localhost:3000` e informe o token configurado no servidor.

Para publicar, configure as mesmas variáveis secretas no serviço de hospedagem do backend. Não coloque credenciais no frontend, no repositório ou na planilha.

## Próximos passos possíveis

Usuários e permissões individuais, tags, observações editáveis, histórico de alterações e integração de mensagens devem entrar em etapas próprias, mantendo o banco PostgreSQL independente do frontend.
