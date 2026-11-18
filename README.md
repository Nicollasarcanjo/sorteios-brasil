<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/5af67347-28a6-4c8f-a8d4-d39fb631298f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Banco de dados (Supabase)

O backend (`server.ts` → `server/persistence.ts`) guarda os dados no Postgres do Supabase.

1. No Supabase, abra **SQL Editor** e rode `supabase/migrations/20261118000000_init.sql`.
2. No `.env` (local) ou nos Secrets do ambiente de deploy, defina:
   - `SUPABASE_URL` — URL do projeto
   - `SUPABASE_SECRET_KEY` — chave secreta (`sb_secret_...` ou `service_role`). Só no servidor, nunca com prefixo `VITE_`.
3. `npm run dev` — o log mostra `[db] Armazenamento: Supabase (...)`.

Sem essas variáveis o servidor usa o arquivo `server/data/db.json` (só para desenvolvimento).
O front-end não acessa o Supabase diretamente: tudo passa pelas rotas `/api/...`.
As tabelas têm RLS ligado e nenhuma policy, então a chave publishable/anon não lê nada.
O servidor mantém o estado em memória, então rode **uma única instância**.

## Deploy no Railway

O `railway.json` já define build (`npm run build`), start (`npm start`), 1 réplica e healthcheck em `/api/raffles`.

1. Railway → **New Project → Deploy from GitHub repo** → escolha este repositório.
2. Em **Variables**, cadastre: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `SESSION_SECRET`, `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET`.
   Sem as cinco primeiras o servidor se recusa a subir em produção.
3. Em **Settings → Networking → Generate Domain** (ou adicione seu domínio).
4. Na AbacatePay, aponte o webhook para `https://SEU-DOMINIO/api/webhooks/abacatepay`.
5. Mantenha **1 réplica** (não ative escala horizontal).

Painel admin: `https://SEU-DOMINIO/paineladmsorteio2026`.
