# project_08

LipariBank — **Project Work Giorno 8: upload KYC, pagination, filtering, aggregation, SSE, soft delete, OpenAPI**.
Base: il Project Work del G7 (Jest + Supertest + Postgres di test isolato).

> **Stato**: codice e test scritti, **non ancora eseguiti**. Il progetto è consegnato senza `node_modules`: `npm install` scarica le nuove dipendenze e aggiorna `package-lock.json`. Usare `npm install`, non `npm ci`, perché il lock è ancora quello del G7.

## Avvio

```bash
npm install
npx prisma generate
cp .env.example .env                 # JWT_ACCESS_SECRET / JWT_REFRESH_SECRET, UPLOAD_DIR
npx prisma migrate deploy            # applica add_kyc_documents, add_soft_delete, add_transfer_feed_index
npm run dev

# Swagger UI:   http://localhost:3000/api-docs
# SSE:          curl -N "http://localhost:3000/api/ai/stream?q=hello" --cookie "access_token=<token>"

# Test (Postgres usa-e-getta su :5434)
npm run db:test:up
npm run test:coverage
```

Le migration in `prisma/migrations/2026101310…` sono scritte a mano nel formato di `prisma migrate dev`. Al primo `npx prisma migrate dev` Prisma confronta schema e migration: se segnala differenze, le rigenera.

## Esercizi

### 1 — KycDocument + upload `POST /api/customers/:id/kyc`

| Dove | Cosa |
|---|---|
| `prisma/schema.prisma`, migration `add_kyc_documents` | Modello `KycDocument`, relazione `Customer.kycDocuments` |
| `src/middleware/kycUpload.ts` | `multer.memoryStorage()`, `fileSize` 5 MB, `fileFilter` su `application/pdf`, `image/jpeg`, `image/png` → altrimenti **415** |
| `src/modules/kyc/kyc.service.ts` | **Magic number** con `file-type`: se il tipo reale del contenuto ≠ MIME dichiarato → `ValidationError` (**422**) |
| `src/modules/kyc/kyc.storage.ts` | Storage simulato: `uploads/kyc/<uuid>.<ext>`, il path va in `storageUrl` (in produzione: Azure Blob / S3, stessa interfaccia `KycStorage`) |
| `src/middleware/errorHandler.ts` | `MulterError LIMIT_FILE_SIZE` → **413 `PAYLOAD_TOO_LARGE`** |

Scelte:
- **`file-type@16.5.4`**: dalla v17 `file-type` è solo ESM, mentre questo progetto (e Jest con ts-jest) è CommonJS. La 16.5.4 è l'ultima versione CommonJS, con la stessa funzione (`fromBuffer`).
- **`customerId @db.Uuid`**: nel modello della traccia è `String` senza tipo DB. `Customer.id` però è `uuid`, e Postgres non permette una FK da una colonna `text` a una `uuid`.
- Il nome su disco lo genera il server (UUID + estensione dalla whitelist). `fileName` conserva il nome originale **ripulito** (senza directory né caratteri di controllo), solo per mostrarlo. `storageUrl` non viene restituito al client, perché è un path interno del server.
- Ordine delle operazioni: prima si salva il file, poi la riga. Se l'INSERT fallisce il file viene cancellato, così non restano file orfani.

### 2 — Pagination offset su `GET /api/accounts`

`?page=1&pageSize=20&status=ACTIVE&type=CHECKING&sortBy=createdAt&order=desc` → `{ data: Account[], meta: { total, page, pageSize, totalPages } }`

- `listAccountsQuerySchema` (`account.types.ts`) con i default e i limiti della traccia. `sortBy` è una **whitelist esplicita** (`createdAt`, `balance`, `iban`): qualunque altro valore (`ownerId`, `deletedAt`, …) → 422.
- Pagina e totale in `prisma.$transaction([findMany, count])` con lo stesso `where`. `totalPages = Math.ceil(total / pageSize)`.
- Ordine **totale**: `[{ [sortBy]: order }, { id: order }]`. A parità di saldo o di `createdAt` Postgres non garantisce l'ordine, e senza un secondo criterio le pagine potrebbero ripetere o saltare righe.

### 3 — Cursor pagination `GET /api/transfers`

`?accountId=...&cursor=<transferId>&limit=20` → `{ data: Transfer[], meta: { nextCursor } }`

- `cursor: cursor ? { id: cursor } : undefined, skip: cursor ? 1 : 0` come da traccia. `accountId` filtra i movimenti in entrata **e** in uscita.
- `orderBy: [{ executedAt: "desc" }, { id: "desc" }]` con indice composto (migration `add_transfer_feed_index`). Con il solo `executedAt`, due bonifici nello stesso istante avrebbero posizione ambigua.
- `take: limit + 1`: la riga in più dice se esiste una pagina successiva. Con "nextCursor se `data.length === limit`", un feed di esattamente `limit` movimenti farebbe chiedere al frontend una pagina vuota.

### 4 — Report `GET /api/reports/balance-by-customer`

`prisma.account.groupBy({ by: ["ownerId"], _sum: { balance: true }, _count: { _all: true }, where: { status: "ACTIVE" } })`, ordinato per saldo decrescente → `[{ ownerId, totalBalance, accountCount }]`. `totalBalance` è una stringa (`"1500.50"`), come tutti gli importi del progetto. Accesso: `authorize("ADMIN", "OPERATOR")`, altrimenti 403. Esclude anche i conti cancellati, perché l'estensione soft delete agisce anche su `groupBy`.

### 5 — SSE `GET /api/ai/stream?q=...`

Servizio AI simulato: 5 eventi `data: {"index","text"}` a 500 ms di distanza, poi `data: [DONE]`. Header: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`, inviati subito con `flushHeaders()`.
- Il testo è serializzato in JSON: un `\n` nella domanda spezzerebbe il frame SSE.
- Se il client chiude la connessione il timer si ferma (`res.on("close")`). Si usa `res` e non `req`, perché da Node 16 `req` emette `close` quando il body è stato letto, non alla disconnessione.
- Verifica: `curl -N "http://localhost:3000/api/ai/stream?q=hello" --cookie "access_token=..."` deve mostrare le righe una alla volta. Il test `aiStream.test.ts` fa la stessa cosa misurando quando arrivano i chunk.

### 6 — Soft delete su Account e Customer

- `deletedAt DateTime?` e `@@index([deletedAt])` su entrambi i modelli (migration `add_soft_delete`).
- **`prisma.$use` non esiste più**: il middleware Prisma è stato deprecato in Prisma 4.16 e rimosso in Prisma 6 (questo progetto usa 6.19, e nei tipi di `@prisma/client` `$use` non c'è). Il sostituto ufficiale è una **Client Extension `query`**, in `src/config/prisma.ts`. Fa la stessa cosa: aggiunge `deletedAt: null` al `where` di `findUnique`, `findFirst`, `findMany` (e varianti `OrThrow`) su Account e Customer. La applico anche a `count`, `aggregate` e `groupBy`, perché un totale o un report non deve contare i cancellati, e a `update` e `updateMany`, perché un PUT su un conto cancellato deve dare 404 e non riportarlo in vita. Se il chiamante filtra già su `deletedAt` (es. un audit) il suo filtro viene rispettato.
- `DELETE /api/accounts/:id` esegue `update({ deletedAt: new Date() })`. Il conto sparisce da tutte le API, ma lo **storico dei bonifici resta**. Prima il DELETE di un conto con bonifici era bloccato dalla FK, ora risponde 204. Un conto cancellato non può fare né ricevere bonifici (404), e il suo IBAN non si riassegna (409).
- Anche `DELETE /api/customers/:id` diventa soft. La regola "un cliente con conti non si cancella", che prima imponeva la FK `Restrict`, ora è controllata nel repository: se ci sono conti attivi la risposta è 409.
- Limite: l'estensione filtra solo la query principale. Le relazioni caricate con `include` e le query raw non sono filtrate.

### 7 — Swagger / OpenAPI

- `src/docs/openapi.ts`: base della specifica (info, `cookieAuth` sul cookie `access_token`, schemi e risposte riusabili). I path sono raccolti da swagger-jsdoc dai blocchi `@openapi` in ogni `*.routes.ts` e in `app.ts`.
- `app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(spec))` e `GET /api-docs.json` per la specifica grezza. Non vengono esposti in produzione.
- Su Windows `path.join` usa `\`, mentre il glob di swagger-jsdoc vuole `/`: senza la conversione la spec uscirebbe senza endpoint.
- Per `/api-docs` la CSP di helmet è senza `upgrade-insecure-requests`, altrimenti su `http://localhost` il browser potrebbe bloccare script e stili della UI.
- `tests/integration/openapi.test.ts` controlla che **tutti** i 21 endpoint siano documentati con le loro risposte e che ogni `$ref` punti a un componente esistente.

## Test

| Suite | Esercizio |
|---|---|
| `src/modules/kyc/kyc.service.test.ts` (unit) + `tests/integration/kyc.test.ts` | 1 — magic number, 415/422/413/404, path traversal, file orfani |
| `tests/integration/accountList.test.ts` + `account.service.test.ts` | 2 — meta, `Math.ceil`, filtri, ordinamento numerico del saldo, whitelist → 422 |
| `tests/integration/transferFeed.test.ts` | 3 — 20+20+5 senza duplicati, bonifici nuovi tra due pagine, stesso `executedAt`, `accountId` |
| `tests/integration/reports.test.ts` | 4 — somme, esclusione di bloccati/chiusi/cancellati, RBAC |
| `tests/integration/aiStream.test.ts` | 5 — header, 5 eventi + `[DONE]`, arrivo distanziato dei chunk |
| `tests/integration/softDelete.test.ts` | 6 — riga presente con `deleted_at`, 404 dopo il delete, niente bonifici, cliente con conti → 409 |
| `tests/integration/openapi.test.ts` | 7 — ogni endpoint documentato, `$ref` validi, UI servita |

Test del G7 adeguati: il DELETE di un conto con bonifici ora risponde 204 (prima 409), il mock del repository ha `findPaginated`, `getAllAccounts` è diventato `listAccounts`.
