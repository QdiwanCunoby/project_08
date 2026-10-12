// Esercizio 3 — GET /api/transfers: feed movimenti con cursor pagination
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app, prisma } from "../../src/app";
import { authCookie } from "../helpers/auth";
import { migrateTestDatabase, truncateAll } from "../helpers/db";

const COOKIE = authCookie(randomUUID());
const BASE = Date.UTC(2026, 9, 1, 10, 0, 0);

interface Feed { data: Array<{ id: string; amount: string; executedAt: string }>; meta: { nextCursor: string | null } }

describe("GET /api/transfers — cursor pagination (integration)", () => {
  let a: string;
  let b: string;
  let c: string;

  // n bonifici da `from` a `to`, executedAt crescente (offsetSec + i secondi); sameInstant = tutti nello stesso istante
  const seed = (n: number, { from = a, to = b, offsetSec = 0, sameInstant = false } = {}) =>
    prisma.transfer.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        fromAccountId: from, toAccountId: to, amount: `${i + 1}.00`, status: "COMPLETED" as const,
        executedAt: new Date(BASE + (sameInstant ? 0 : (offsetSec + i) * 1000)),
      })),
    });

  const feed = async (query: string): Promise<Feed> =>
    (await request(app).get(`/api/transfers?${query}`).set("Cookie", COOKIE).expect(200)).body;

  // Come useInfiniteQuery: getNextPageParam: last => last.meta.nextCursor
  const readAll = async (limit: number, extra = "") => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Feed = await feed(`limit=${limit}${cursor ? `&cursor=${cursor}` : ""}${extra}`);
      ids.push(...page.data.map(t => t.id));
      cursor = page.meta.nextCursor;
    } while (cursor);
    return ids;
  };

  beforeAll(() => {
    migrateTestDatabase();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    const owner = await prisma.customer.create({
      data: { fiscalCode: "RSSMRA80A01H501U", firstName: "Mario", lastName: "Rossi", email: "mario.rossi@example.com", phone: "+39 333 1234567" },
    });
    const ibans = ["IT60X0542811101000000123456", "IT28W8000000292100645211208", "IT02A0300203280000400162854"];
    [a, b, c] = await Promise.all(ibans.map(async iban =>
      (await prisma.account.create({ data: { ownerId: owner.id, iban, type: "CHECKING" } })).id));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("prima pagina: i 20 più recenti (executedAt desc) e meta.nextCursor = id dell'ultimo", async () => {
    await seed(45);

    const page = await feed("limit=20");

    expect(page.data).toHaveLength(20);
    expect(page.data[0].amount).toBe("45.00");
    expect(page.meta.nextCursor).toBe(page.data[19].id);
    const times = page.data.map(t => Date.parse(t.executedAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
  });

  it("seguendo nextCursor: 20 + 20 + 5, ogni movimento una sola volta, poi nextCursor null", async () => {
    await seed(45);

    const ids = await readAll(20);

    expect(ids).toHaveLength(45);
    expect(new Set(ids).size).toBe(45);
  });

  it("bonifici nuovi arrivati tra pagina 1 e 2 → con il cursor nessun duplicato", async () => {
    await seed(30);
    const first = await feed("limit=10");
    await seed(5, { offsetSec: 1000 });   // più recenti di tutto: finiscono in cima al feed

    const second = await feed(`limit=10&cursor=${first.meta.nextCursor}`);

    const seen = new Set(first.data.map(t => t.id));
    expect(second.data.some(t => seen.has(t.id))).toBe(false);
    expect(second.data[0].amount).toBe("20.00");   // riprende esattamente dopo l'ultimo visto (21.00)
  });

  it("movimenti con lo stesso executedAt: lo spareggio su id non salta né ripete righe", async () => {
    await seed(12, { sameInstant: true });
    const ids = await readAll(5);
    expect(new Set(ids).size).toBe(12);
  });

  it("esattamente `limit` movimenti → nextCursor null subito (nessuna pagina vuota)", async () => {
    await seed(20);
    expect((await feed("limit=20")).meta.nextCursor).toBeNull();
  });

  it("accountId → solo i movimenti in entrata o in uscita di quel conto", async () => {
    await seed(3);                       // a → b
    await seed(2, { from: c, to: a });   // c → a

    expect((await feed(`accountId=${a}`)).data).toHaveLength(5);
    expect((await feed(`accountId=${b}`)).data).toHaveLength(3);
    expect((await feed(`accountId=${c}`)).data).toHaveLength(2);
  });

  it("query non valida → 422 (limit 0 / 101, cursor e accountId non UUID); senza login → 401", async () => {
    for (const q of ["limit=0", "limit=101", "cursor=abc", "accountId=123"]) {
      expect((await request(app).get(`/api/transfers?${q}`).set("Cookie", COOKIE)).status).toBe(422);
    }
    await request(app).get("/api/transfers").expect(401);
  });
});
