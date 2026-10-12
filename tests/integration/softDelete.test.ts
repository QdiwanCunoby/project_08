// Esercizio 6 — soft delete su Account e Customer tramite estensione Prisma (sostituto di prisma.$use)
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app, prisma } from "../../src/app";
import { authCookie } from "../helpers/auth";
import { migrateTestDatabase, truncateAll } from "../helpers/db";

const ADMIN = authCookie(randomUUID(), "ADMIN");
const FROM_IBAN = "IT60X0542811101000000123456";
const TO_IBAN = "IT28W8000000292100645211208";

describe("Soft delete (integration)", () => {
  let ownerId: string;
  let fromId: string;
  let toId: string;

  beforeAll(() => {
    migrateTestDatabase();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    ownerId = (await prisma.customer.create({
      data: { fiscalCode: "RSSMRA80A01H501U", firstName: "Mario", lastName: "Rossi", email: "mario.rossi@example.com", phone: "+39 333 1234567" },
    })).id;
    fromId = (await prisma.account.create({ data: { ownerId, iban: FROM_IBAN, type: "CHECKING", balance: "1000.00" } })).id;
    toId = (await prisma.account.create({ data: { ownerId, iban: TO_IBAN, type: "SAVINGS", balance: "0.00" } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const deleteAccount = (id: string) => request(app).delete(`/api/accounts/${id}`).set("Cookie", ADMIN);

  describe("DELETE /api/accounts/:id", () => {
    it("non cancella la riga: imposta deletedAt", async () => {
      await deleteAccount(fromId).expect(204);

      // Query raw: non passa dall'estensione, vede la tabella com'è davvero
      const rows = await prisma.$queryRaw<Array<{ deleted_at: Date | null }>>`SELECT deleted_at FROM accounts WHERE id = ${fromId}::uuid`;
      expect(rows).toHaveLength(1);
      expect(rows[0].deleted_at).toBeInstanceOf(Date);
    });

    it("dopo la cancellazione il conto sparisce da GET /:id (404), dalla lista e dal total", async () => {
      await deleteAccount(fromId).expect(204);

      await request(app).get(`/api/accounts/${fromId}`).set("Cookie", ADMIN).expect(404);
      const list = await request(app).get("/api/accounts").set("Cookie", ADMIN).expect(200);
      expect(list.body.data.map((a: { id: string }) => a.id)).toEqual([toId]);
      expect(list.body.meta.total).toBe(1);
    });

    it("cancellare due volte → 404; PUT su un conto cancellato → 404 (non lo resuscita)", async () => {
      await deleteAccount(fromId).expect(204);

      await deleteAccount(fromId).expect(404);
      await request(app).put(`/api/accounts/${fromId}`).set("Cookie", ADMIN).send({ status: "ACTIVE" }).expect(404);
    });

    it("un conto cancellato non può fare né ricevere bonifici (404)", async () => {
      await deleteAccount(toId).expect(204);

      const res = await request(app).post("/api/transfers").set("Cookie", ADMIN).send({ fromIban: FROM_IBAN, toIban: TO_IBAN, amount: "10.00" });

      expect(res.status).toBe(404);
      expect((await prisma.account.findUniqueOrThrow({ where: { id: fromId } })).balance.toFixed(2)).toBe("1000.00");
    });

    it("l'IBAN di un conto cancellato non si riassegna (unique sul DB) → 409", async () => {
      await deleteAccount(fromId).expect(204);

      const res = await request(app).post("/api/accounts").set("Cookie", ADMIN).send({ ownerId, iban: FROM_IBAN, type: "CHECKING" });
      expect(res.status).toBe(409);
    });
  });

  describe("estensione Prisma", () => {
    beforeEach(async () => {
      await prisma.account.update({ where: { id: fromId }, data: { deletedAt: new Date() } });
    });

    it("findMany / findFirst / findUnique / count / aggregate nascondono i cancellati", async () => {
      expect(await prisma.account.findMany()).toHaveLength(1);
      expect(await prisma.account.findFirst({ where: { iban: FROM_IBAN } })).toBeNull();
      expect(await prisma.account.findUnique({ where: { id: fromId } })).toBeNull();
      expect(await prisma.account.count()).toBe(1);
      expect((await prisma.account.aggregate({ _sum: { balance: true } }))._sum.balance!.toFixed(2)).toBe("0.00");
    });

    it("chi filtra esplicitamente su deletedAt (es. audit) vede i cancellati", async () => {
      const deleted = await prisma.account.findMany({ where: { deletedAt: { not: null } } });
      expect(deleted.map(a => a.id)).toEqual([fromId]);
    });
  });

  describe("DELETE /api/customers/:id", () => {
    it("cliente con conti attivi → 409; senza conti attivi → 204 soft delete, poi 404", async () => {
      const customerUrl = `/api/customers/${ownerId}`;
      await request(app).delete(customerUrl).set("Cookie", ADMIN).expect(409);

      await deleteAccount(fromId).expect(204);
      await deleteAccount(toId).expect(204);
      await request(app).delete(customerUrl).set("Cookie", ADMIN).expect(204);

      await request(app).get(customerUrl).set("Cookie", ADMIN).expect(404);
      const rows = await prisma.$queryRaw<Array<{ deleted_at: Date | null }>>`SELECT deleted_at FROM customers WHERE id = ${ownerId}::uuid`;
      expect(rows[0].deleted_at).toBeInstanceOf(Date);
    });
  });
});
