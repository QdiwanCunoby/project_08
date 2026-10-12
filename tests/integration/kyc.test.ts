// Esercizio 1 — POST /api/customers/:id/kyc su Postgres reale, storage locale in UPLOAD_DIR (.env.test)
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app, prisma } from "../../src/app";
import { env } from "../../src/config/env";
import { authCookie } from "../helpers/auth";
import { migrateTestDatabase, truncateAll } from "../helpers/db";

const COOKIE = authCookie(randomUUID());
const KYC_DIR = path.resolve(env.uploadDir, "kyc");

// Contenuti minimi con i magic number giusti (quelli che legge file-type).
// Il PDF è allungato oltre 2 KB: per distinguere PDF e Adobe Illustrator file-type salta i primi ~1350 byte.
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n"), Buffer.alloc(2048, 0x20), Buffer.from("\n%%EOF\n")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(126)]);

const storedFiles = () => (fs.existsSync(KYC_DIR) ? fs.readdirSync(KYC_DIR) : []);

describe("POST /api/customers/:id/kyc (integration)", () => {
  let customerId: string;

  const upload = (content: Buffer, filename: string, contentType: string, id = customerId) =>
    request(app).post(`/api/customers/${id}/kyc`).set("Cookie", COOKIE).attach("file", content, { filename, contentType });

  beforeAll(() => {
    migrateTestDatabase();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    fs.rmSync(KYC_DIR, { recursive: true, force: true });
    const customer = await prisma.customer.create({
      data: { fiscalCode: "RSSMRA80A01H501U", firstName: "Mario", lastName: "Rossi", email: "mario.rossi@example.com", phone: "+39 333 1234567" },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    fs.rmSync(KYC_DIR, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("PDF valido → 201, riga in kyc_documents e file nello storage con nome generato dal server", async () => {
    const res = await upload(PDF, "carta-identita.pdf", "application/pdf");

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ customerId, fileName: "carta-identita.pdf", mimeType: "application/pdf", sizeBytes: PDF.length });
    expect(res.body.data).not.toHaveProperty("storageUrl");

    const row = await prisma.kycDocument.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.storageUrl).toMatch(/kyc\/[0-9a-f-]{36}\.pdf$/);
    expect(fs.readFileSync(path.resolve(row.storageUrl))).toEqual(PDF);
  });

  it("JPEG e PNG → 201 con estensione dalla whitelist", async () => {
    await upload(JPEG, "selfie.jpeg", "image/jpeg").expect(201);
    await upload(PNG, "bolletta.png", "image/png").expect(201);
    expect(storedFiles().map(f => path.extname(f)).sort()).toEqual([".jpg", ".png"]);
  });

  it("filename con path traversal → salvato comunque dentro lo storage; fileName ripulito", async () => {
    const res = await upload(PDF, "../../../etc/passwd.pdf", "application/pdf").expect(201);

    expect(res.body.data.fileName).toBe("passwd.pdf");
    expect(storedFiles()).toHaveLength(1);
  });

  it("magic number non coerente: .exe dichiarato application/pdf → 422 VALIDATION_ERROR, nulla salvato", async () => {
    const res = await upload(EXE, "estratto-conto.pdf", "application/pdf");

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].field).toBe("file");
    expect(storedFiles()).toEqual([]);
    expect(await prisma.kycDocument.count()).toBe(0);
  });

  it("PNG dichiarato come PDF → 422 (il tipo reale vince sull'header)", async () => {
    expect((await upload(PNG, "doc.pdf", "application/pdf")).status).toBe(422);
  });

  it("MIME non in whitelist → 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const res = await upload(EXE, "setup.exe", "application/x-msdownload");

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("file oltre 5 MB → 413 PAYLOAD_TOO_LARGE", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload(big, "grande.pdf", "application/pdf");

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("cliente inesistente → 404; cliente cancellato (soft delete) → 404; id non UUID → 422", async () => {
    await upload(PDF, "a.pdf", "application/pdf", randomUUID()).expect(404);

    await prisma.customer.update({ where: { id: customerId }, data: { deletedAt: new Date() } });
    await upload(PDF, "a.pdf", "application/pdf").expect(404);

    await upload(PDF, "a.pdf", "application/pdf", "non-un-uuid").expect(422);
  });

  it("nessun file → 422; senza login → 401", async () => {
    const res = await request(app).post(`/api/customers/${customerId}/kyc`).set("Cookie", COOKIE).field("note", "niente");
    expect(res.status).toBe(422);

    await request(app).post(`/api/customers/${customerId}/kyc`).attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" }).expect(401);
  });
});
