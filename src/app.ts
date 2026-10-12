// Configurazione Express app + composition root — separata da index.ts per i test
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { openApiSpec } from "./docs/openapi";
import { requestId } from "./middleware/requestId";
import { requestLogger } from "./middleware/requestLogger";
import { notFoundHandler } from "./middleware/notFoundHandler";
import { errorHandler } from "./middleware/errorHandler";
import { createAuthenticate } from "./middleware/authenticate";
import { IUserRepository, PrismaUserRepository } from "./modules/auth/auth.repository";
import { AuthService } from "./modules/auth/auth.service";
import { AuthController } from "./modules/auth/auth.controller";
import { createAuthRoutes } from "./modules/auth/auth.routes";
import { IAccountRepository, PrismaAccountRepository } from "./modules/account/account.repository";
import { AccountService } from "./modules/account/account.service";
import { AccountController } from "./modules/account/account.controller";
import { createAccountRoutes } from "./modules/account/account.routes";
import { ICustomerRepository, PrismaCustomerRepository } from "./modules/customer/customer.repository";
import { CustomerService } from "./modules/customer/customer.service";
import { CustomerController } from "./modules/customer/customer.controller";
import { createCustomerRoutes } from "./modules/customer/customer.routes";
import { PrismaTransferRepository } from "./modules/transfer/transfer.repository";
import { TransferService } from "./modules/transfer/transfer.service";
import { TransferController } from "./modules/transfer/transfer.controller";
import { createTransferRoutes } from "./modules/transfer/transfer.routes";
import { PrismaKycRepository } from "./modules/kyc/kyc.repository";
import { KycStorage, LocalKycStorage } from "./modules/kyc/kyc.storage";
import { KycService } from "./modules/kyc/kyc.service";
import { createKycRoutes } from "./modules/kyc/kyc.routes";
import { ReportService } from "./modules/report/report.service";
import { createReportRoutes } from "./modules/report/report.routes";
import { createAiRoutes } from "./modules/ai/ai.routes";

// `prisma` (src/config/prisma.ts) è UN SOLO client per processo, già esteso con il soft delete su Account e Customer

export interface AppDeps {
  users: IUserRepository;
  accounts: IAccountRepository;
  customers: ICustomerRepository;
  kycStorage: KycStorage;
  aiChunkIntervalMs: number;
}

// ─── Composition root: Repository → Service → Controller → Routes ───
// In produzione tutto è Prisma / disco locale; i test sostituiscono solo ciò che serve
// (repository in memoria, intervallo SSE più corto): le dipendenze non passate restano quelle di default.
export const createApp = (overrides: Partial<AppDeps> = {}) => {
  const deps: AppDeps = {
    users: overrides.users ?? new PrismaUserRepository(prisma),
    accounts: overrides.accounts ?? new PrismaAccountRepository(prisma),
    customers: overrides.customers ?? new PrismaCustomerRepository(prisma),
    kycStorage: overrides.kycStorage ?? new LocalKycStorage(env.uploadDir),
    aiChunkIntervalMs: overrides.aiChunkIntervalMs ?? 500,
  };

  const authService = new AuthService(deps.users);
  const authenticate = createAuthenticate(authService);
  const authRoutes = createAuthRoutes(new AuthController(authService), authenticate);
  const accountRoutes = createAccountRoutes(new AccountController(new AccountService(deps.accounts)));
  const customerRoutes = createCustomerRoutes(new CustomerController(new CustomerService(deps.customers)));
  const kycRoutes = createKycRoutes(new KycService(deps.customers, new PrismaKycRepository(prisma), deps.kycStorage));
  const transferRoutes = createTransferRoutes(
    new TransferController(new TransferService(prisma, new PrismaTransferRepository(prisma))),   // apre lui la $transaction
  );
  const reportRoutes = createReportRoutes(new ReportService(prisma));
  const aiRoutes = createAiRoutes({ chunkIntervalMs: deps.aiChunkIntervalMs });

  const app = express();

  // ─── Pipeline middleware (l'ordine conta: ogni richiesta li attraversa dall'alto in basso) ───
  app.use(requestId);                                                        // 1. req.id + header X-Request-Id
  app.use(requestLogger);                                                    // 2. pino-http: log con reqId, status, ms
  app.use(helmet());                                                         // 3. Security headers
  app.use(cors({ origin: env.corsOrigin.split(","), credentials: true, exposedHeaders: ["X-Request-Id"] })); // 4. CORS
  app.use(express.json({ limit: "100kb" }));                                 // 5. Parse body JSON → req.body (il multipart lo legge multer)
  app.use(cookieParser());                                                   // 6. Parse cookie → req.cookies (PRIMA dei router)

  // ─── Documentazione OpenAPI (Swagger UI) ───
  // Non in produzione: la mappa completa delle API è un'informazione utile a un attaccante.
  // CSP di helmet: senza "upgrade-insecure-requests" la UI funziona anche su http://localhost.
  if (env.nodeEnv !== "production") {
    app.get("/api-docs.json", (_req, res) => { res.json(openApiSpec); });
    app.use(
      "/api-docs",
      helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }),
      swaggerUi.serve,
      swaggerUi.setup(openApiSpec, { customSiteTitle: "LipariBank API", swaggerOptions: { withCredentials: true } }),
    );
  }

  // ─── Routes: authenticate PRIMA delle route che protegge (Express applica i middleware in ordine) ───
  app.use("/api/auth", authRoutes);                                          // pubbliche (me si protegge da sola)
  app.use("/api/customers/:id/kyc", authenticate, kycRoutes);                // upload documenti KYC (multipart)
  app.use("/api/accounts", authenticate, accountRoutes);                     // 401 senza login; DELETE solo ADMIN (403)
  app.use("/api/customers", authenticate, customerRoutes);                   // 401 senza login; DELETE solo ADMIN (403)
  app.use("/api/transfers", authenticate, transferRoutes);                   // 401 senza login
  app.use("/api/reports", authenticate, reportRoutes);                       // solo ADMIN / OPERATOR (403)
  app.use("/api/ai", authenticate, aiRoutes);                                // SSE (servizio AI simulato)

  /**
   * @openapi
   * /health:
   *   get:
   *     tags: [System]
   *     summary: Health check
   *     security: []
   *     responses:
   *       200:
   *         description: Il servizio risponde
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: object
   *                   properties:
   *                     status: { type: string, example: ok }
   *                     timestamp: { type: string, format: date-time }
   */
  app.get("/health", (req, res) => {
    res.json({ data: { status: "ok", timestamp: new Date().toISOString() } });
  });

  // ─── 404 catch-all + error handler (sempre per ultimi: errorHandler è l'ULTIMO app.use) ───
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

const app = createApp();

export { app, prisma };
