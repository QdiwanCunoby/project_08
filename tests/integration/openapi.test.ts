// Esercizio 7 — Swagger UI su /api-docs e specifica OpenAPI completa
import request from "supertest";
import { app, prisma } from "../../src/app";
import { openApiSpec } from "../../src/docs/openapi";

type Paths = Record<string, Record<string, { responses?: Record<string, unknown> }>>;

afterAll(async () => {
  await prisma.$disconnect();
});

// Ogni endpoint dell'app, con il metodo: se una route nuova non viene annotata il test fallisce
const ENDPOINTS: Array<[string, string]> = [
  ["post", "/api/auth/register"], ["post", "/api/auth/login"], ["post", "/api/auth/refresh"],
  ["post", "/api/auth/logout"], ["get", "/api/auth/me"],
  ["get", "/api/customers"], ["post", "/api/customers"], ["get", "/api/customers/{id}"],
  ["put", "/api/customers/{id}"], ["delete", "/api/customers/{id}"], ["post", "/api/customers/{id}/kyc"],
  ["get", "/api/accounts"], ["post", "/api/accounts"], ["get", "/api/accounts/{id}"],
  ["put", "/api/accounts/{id}"], ["delete", "/api/accounts/{id}"],
  ["get", "/api/transfers"], ["post", "/api/transfers"],
  ["get", "/api/reports/balance-by-customer"], ["get", "/api/ai/stream"], ["get", "/health"],
];

describe("OpenAPI", () => {
  const paths = openApiSpec.paths as Paths;

  it.each(ENDPOINTS)("%s %s è documentato con le sue risposte", (method, path) => {
    expect(paths[path]?.[method]).toBeDefined();
    expect(Object.keys(paths[path][method].responses ?? {}).length).toBeGreaterThan(0);
  });

  it("tutti i $ref puntano a componenti esistenti", () => {
    const refs = [...JSON.stringify(openApiSpec).matchAll(/"\$ref":"#\/components\/(\w+)\/(\w+)"/g)];
    const components = openApiSpec.components as Record<string, Record<string, unknown>>;

    expect(refs.length).toBeGreaterThan(0);
    for (const [, section, name] of refs) {
      expect(components[section]?.[name]).toBeDefined();
    }
  });

  it("GET /api-docs.json restituisce la specifica; GET /api-docs/ serve la Swagger UI", async () => {
    const json = await request(app).get("/api-docs.json").expect(200);
    expect(json.body.openapi).toBe("3.0.3");

    const ui = await request(app).get("/api-docs/").expect(200);
    expect(ui.headers["content-type"]).toMatch(/text\/html/);
    expect(ui.text).toContain("swagger-ui");
  });
});
