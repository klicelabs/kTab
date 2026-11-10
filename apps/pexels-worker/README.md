# Klice Start Pexels Worker

This Worker replaces the file-backed Next.js proxy for production. It keeps
search results, provider quota state, and shared request budgets in D1. The
Pexels API key is a Cloudflare secret and is never included in the extension.

## One-time Cloudflare setup

From this folder:

1. Run `bun run db:create` and copy the database ID Wrangler returns into
   `database_id` in `wrangler.toml`.
2. Run `bun run db:migrate:remote` to create the cache and quota tables.
3. Run `bunx wrangler secret put PEXELS_API_KEY` and enter the Pexels key in
   Wrangler's secure prompt.
4. Run `bun run deploy`. Wrangler prints the public `workers.dev` URL.
5. Set `VITE_PEXELS_PROXY_URL` to `<workers.dev URL>/api/pexels` when building
   the extension for the store.

Do not put the Pexels key in `wrangler.toml`, source code, or extension build
variables. Rotate it in the Pexels account and replace the Cloudflare secret if
it is exposed.

## Local development

Run `bun run db:migrate:local`, then `bun run dev`. For upstream requests, add
`PEXELS_API_KEY` to an ignored `.dev.vars` file in this folder. Local D1 data is
separate from the remote database.

Run `bun run typecheck` and `bun run test` from this folder to validate changes.
