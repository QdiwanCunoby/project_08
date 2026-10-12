// Esercizio 2 — GET /api/accounts con pagination offset, filtri e ordinamento in whitelist
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app, prisma } from "../../src/app";
import { authCookie } from "../helpers/auth";
import { migrateTestDatabase, truncateAll } from "../helpers/db";

const COOKIE = authCookie(randomUUID());
const ibanFor = (n: number) => `IT00X${String(n).padStart(22, "0")}`;

interface AccountDto { id: string; iban: string; balance: string; type: string; status: string; createdAt: string }

describe("GET /api/accounts — pagination, filtering, sorting (integration)", () => {
  const list = async (query: string) => request(app).get(`/api/accounts?${query}`).set("Cookie", COOKIE);

  beforeAll(() => {
    migrateTestDatabase();
  });

  // 25 conti: saldi 10..250, 5 SAVINGS (i multipli di 5) e 3 BLOCKED (i multipli di 8)
  beforeEach(async () => {
    await truncateAll(prisma);
    const owner = await prisma.customer.create({
      data: { fiscalCode: "RSSMRA80A01H501U", firstName: "Mario", lastName: "Rossi", email: "mario.rossi@example.com", phone: "+39 333 1234567" },
    });
    await prisma.account.createMany({
      data: Array.from({ length: 25 }, (_, i) => {
        const n = i + 1;
        return {
          ownerId: owner.id,
          iban: ibanFor(n),
          balance: `${n * 10}.00`,
          type: n % 5 === 0 ? "SAVINGS" as const : "CHECKING" as const,
          status: n % 8 === 0 ? "BLOCKED" as const : "ACTIVE" as const,
          createdAt: new Date(Date.UTC(2026, 0, n)),   // un conto al giorno: createdAt distinti
        };
      }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("default: page 1, pageSize 20, ordinati per createdAt desc; meta con total e totalPages", async () => {
    const res = await list("");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.meta).toEqual({ total: 25, page: 1, pageSize: 20, totalPages: 2 });
    expect(res.body.data[0].iban).toBe(ibanFor(25));   // il più recente
  });

  it("page=3&pageSize=10 → ultime 5 righe, totalPages 3 (Math.ceil di 2.5)", async () => {
    const res = await list("page=3&pageSize=10");

    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta).toEqual({ total: 25, page: 3, pageSize: 10, totalPages: 3 });
  });

  it("scorrendo tutte le pagine ogni conto compare una sola volta", async () => {
    const ids: string[] = [];
    for (let page = 1; page <= 3; page++) {
      ids.push(...(await list(`page=${page}&pageSize=10`)).body.data.map((a: AccountDto) => a.id));
    }
    expect(new Set(ids).size).toBe(25);
  });

  it("sortBy=balance&order=asc / desc → saldi ordinati numericamente (non come stringhe)", async () => {
    const asc = (await list("sortBy=balance&order=asc&pageSize=3")).body.data.map((a: AccountDto) => a.balance);
    const desc = (await list("sortBy=balance&order=desc&pageSize=3")).body.data.map((a: AccountDto) => a.balance);

    expect(asc).toEqual(["10.00", "20.00", "30.00"]);       // come stringhe "100.00" < "20.00"
    expect(desc).toEqual(["250.00", "240.00", "230.00"]);
  });

  it("sortBy=iban&order=asc → ordine per IBAN", async () => {
    const ibans = (await list("sortBy=iban&order=asc&pageSize=2")).body.data.map((a: AccountDto) => a.iban);
    expect(ibans).toEqual([ibanFor(1), ibanFor(2)]);
  });

  it("filtri status e type, anche combinati: total conta solo le righe filtrate", async () => {
    expect((await list("type=SAVINGS")).body.meta.total).toBe(5);
    expect((await list("status=BLOCKED")).body.meta.total).toBe(3);

    const combined = await list("status=ACTIVE&type=SAVINGS&pageSize=2");
    expect(combined.body.meta).toEqual({ total: 5, page: 1, pageSize: 2, totalPages: 3 });   // 5,10,15,20,25: nessuno BLOCKED
    expect(combined.body.data.every((a: AccountDto) => a.type === "SAVINGS" && a.status === "ACTIVE")).toBe(true);
  });

  it("conti cancellati (soft delete) esclusi dalla pagina e dal total", async () => {
    await prisma.account.updateMany({ where: { iban: { in: [ibanFor(1), ibanFor(2)] } }, data: { deletedAt: new Date() } });

    expect((await list("")).body.meta.total).toBe(23);
  });

  it("whitelist: sortBy fuori lista, order non valido, pageSize > 100, page 0 → 422", async () => {
    for (const q of ["sortBy=ownerId", "sortBy=deletedAt", "order=random", "pageSize=101", "page=0", "status=FROZEN", "type=GOLD"]) {
      const res = await list(q);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
