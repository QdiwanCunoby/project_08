// Esercizio 4 — GET /api/reports/balance-by-customer (groupBy)
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app, prisma } from "../../src/app";
import { authCookie } from "../helpers/auth";
import { migrateTestDatabase, truncateAll } from "../helpers/db";

const ibanFor = (n: number) => `IT00X${String(n).padStart(22, "0")}`;

describe("GET /api/reports/balance-by-customer (integration)", () => {
  let mario: string;
  let giulia: string;
  let luca: string;

  beforeAll(() => {
    migrateTestDatabase();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    const customer = (fiscalCode: string, email: string) =>
      prisma.customer.create({ data: { fiscalCode, firstName: "N", lastName: "N", email, phone: "+39 333 1234567" } });
    mario = (await customer("RSSMRA80A01H501U", "mario@example.com")).id;
    giulia = (await customer("VRDGLI90B41F205Z", "giulia@example.com")).id;
    luca = (await customer("BNCLCU85C10F839X", "luca@example.com")).id;

    await prisma.account.createMany({
      data: [
        { ownerId: mario, iban: ibanFor(1), type: "CHECKING", balance: "1000.00" },
        { ownerId: mario, iban: ibanFor(2), type: "SAVINGS", balance: "500.50" },
        { ownerId: mario, iban: ibanFor(3), type: "CHECKING", balance: "9999.00", status: "BLOCKED" },   // escluso: non attivo
        { ownerId: giulia, iban: ibanFor(4), type: "CHECKING", balance: "2500.00" },
        { ownerId: giulia, iban: ibanFor(5), type: "CHECKING", balance: "700.00", deletedAt: new Date() }, // escluso: cancellato
        { ownerId: luca, iban: ibanFor(6), type: "CHECKING", balance: "300.00", status: "CLOSED" },        // luca: nessun conto attivo
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const report = (role: "USER" | "OPERATOR" | "ADMIN") =>
    request(app).get("/api/reports/balance-by-customer").set("Cookie", authCookie(randomUUID(), role));

  it("ADMIN → somma e conteggio dei soli conti ATTIVI e non cancellati, ordinati per saldo decrescente", async () => {
    const res = await report("ADMIN");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { ownerId: giulia, totalBalance: "2500.00", accountCount: 1 },
      { ownerId: mario, totalBalance: "1500.50", accountCount: 2 },
    ]);
  });

  it("OPERATOR → 200; USER → 403; senza login → 401", async () => {
    await report("OPERATOR").expect(200);
    const forbidden = await report("USER");
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
    await request(app).get("/api/reports/balance-by-customer").expect(401);
  });

  it("nessun conto attivo → array vuoto", async () => {
    await prisma.account.updateMany({ data: { status: "CLOSED" } });
    expect((await report("ADMIN")).body.data).toEqual([]);
  });
});
