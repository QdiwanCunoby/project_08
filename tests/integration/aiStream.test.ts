// Esercizio 5 — GET /api/ai/stream (SSE con servizio AI simulato)
// L'app gira su una porta vera: serve leggere i chunk man mano che arrivano, come fa `curl -N`.
import http from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { createApp, prisma } from "../../src/app";
import { generateTestToken } from "../helpers/auth";

const COOKIE = `access_token=${generateTestToken(randomUUID())}`;
const INTERVAL = 50;   // ms tra un chunk e l'altro nei test (500 in produzione)

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer(createApp({ aiChunkIntervalMs: INTERVAL }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
});

interface Received { status?: number; headers: http.IncomingHttpHeaders; chunks: Array<{ at: number; text: string }> }

// Equivalente di `curl -N`: registra ogni chunk TCP con l'istante di arrivo
const stream = (query: string, cookie: string | null = COOKIE): Promise<Received> =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.get(`${baseUrl}/api/ai/stream?${query}`, { headers: cookie ? { Cookie: cookie } : {} }, res => {
      const received: Received = { status: res.statusCode, headers: res.headers, chunks: [] };
      res.setEncoding("utf8");
      res.on("data", (text: string) => received.chunks.push({ at: Date.now() - start, text }));
      res.on("end", () => resolve(received));
    });
    req.on("error", reject);
  });

describe("GET /api/ai/stream", () => {
  it("header SSE obbligatori", async () => {
    const { status, headers } = await stream("q=hello");

    expect(status).toBe(200);
    expect(headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(headers["cache-control"]).toBe("no-cache");
    expect(headers["connection"]).toBe("keep-alive");
    expect(headers["x-accel-buffering"]).toBe("no");
  });

  it("5 eventi data con i messaggi, poi data: [DONE]", async () => {
    const { chunks } = await stream("q=hello");
    const events = chunks.map(c => c.text).join("").split("\n\n").filter(Boolean);

    expect(events).toHaveLength(6);
    const payloads = events.slice(0, 5).map(e => JSON.parse(e.replace(/^data: /, "")));
    expect(payloads.map(p => p.index)).toEqual([0, 1, 2, 3, 4]);
    expect(payloads[0].text).toContain("hello");
    expect(events[5]).toBe("data: [DONE]");
  });

  it("i chunk arrivano uno alla volta, distanziati nel tempo (non tutti insieme alla fine)", async () => {
    const { chunks } = await stream("q=hello");
    const dataChunks = chunks.filter(c => c.text.includes('"index"'));

    // Ogni evento è un write separato: almeno 5 arrivi distinti, e tra il primo e l'ultimo passano ~4 intervalli
    expect(dataChunks.length).toBeGreaterThanOrEqual(5);
    expect(dataChunks[dataChunks.length - 1].at - dataChunks[0].at).toBeGreaterThanOrEqual(INTERVAL * 3);
  });

  it("una domanda con a capo non spezza il frame SSE (testo serializzato in JSON)", async () => {
    const { chunks } = await stream(`q=${encodeURIComponent("riga1\n\nriga2")}`);
    const events = chunks.map(c => c.text).join("").split("\n\n").filter(Boolean);
    expect(events).toHaveLength(6);
  });

  it("senza login → 401; q mancante o vuoto → 422", async () => {
    expect((await stream("q=hello", null)).status).toBe(401);
    expect((await stream("")).status).toBe(422);
    expect((await stream("q=%20%20")).status).toBe(422);
  });
});
