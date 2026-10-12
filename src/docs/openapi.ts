// Specifica OpenAPI 3: la base (info, sicurezza, schemi riusabili) è qui; i path li raccoglie swagger-jsdoc
// dai blocchi JSDoc @openapi accanto a ogni route (src/modules/**/*.routes.ts e app.ts).
import path from "node:path";
import swaggerJsdoc from "swagger-jsdoc";

// Su Windows path.join usa "\" ma il glob di swagger-jsdoc vuole "/": senza conversione non trova nessun file
const glob = (...parts: string[]) => path.join(__dirname, ...parts).split(path.sep).join("/");

const error = (code: string, message: string) => ({
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string", example: code },
        message: { type: "string", example: message },
      },
    },
  },
});

const definition = {
  openapi: "3.0.3",
  info: {
    title: "LipariBank Digital Channels API",
    version: "1.0.0",
    description:
      "API del project work LipariBank. Autenticazione con cookie HttpOnly: fare login con POST /api/auth/login " +
      "(il browser salva i cookie), poi le altre chiamate da questa pagina li inviano in automatico.",
  },
  tags: [
    { name: "Auth" }, { name: "Customers" }, { name: "KYC" }, { name: "Accounts" },
    { name: "Transfers" }, { name: "Reports" }, { name: "AI" }, { name: "System" },
  ],
  // Tutte le route richiedono il cookie access_token, salvo quelle con `security: []`
  security: [{ cookieAuth: [] }],
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "access_token" },
      refreshCookie: { type: "apiKey", in: "cookie", name: "refresh_token" },
    },
    parameters: {
      IdPath: { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
    },
    schemas: {
      Role: { type: "string", enum: ["USER", "OPERATOR", "ADMIN"] },
      AccountStatus: { type: "string", enum: ["ACTIVE", "BLOCKED", "CLOSED"] },
      AccountType: { type: "string", enum: ["CHECKING", "SAVINGS", "BUSINESS"] },
      CustomerStatus: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
      Money: { type: "string", pattern: "^\\d+\\.\\d{2}$", example: "1000.00", description: "Importo decimale come stringa (mai number)" },

      Error: error("NOT_FOUND", "Risorsa non trovata"),
      ValidationError: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "VALIDATION_ERROR" },
              message: { type: "string", example: "Dati non validi" },
              details: {
                type: "array",
                items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } },
              },
            },
          },
        },
      },

      PublicUser: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          role: { $ref: "#/components/schemas/Role" },
          customerId: { type: "string", format: "uuid", nullable: true },
        },
      },
      RegisterInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "mario.rossi@example.com" },
          password: { type: "string", minLength: 8, maxLength: 72, example: "Password123!", description: "Maiuscola, minuscola, cifra e simbolo" },
          firstName: { type: "string", example: "Mario" },
          lastName: { type: "string", example: "Rossi" },
        },
      },
      LoginInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "mario.rossi@example.com" },
          password: { type: "string", example: "Password123!" },
        },
      },

      Customer: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          fiscalCode: { type: "string", example: "RSSMRA80A01H501U" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string", example: "+39 333 1234567" },
          status: { $ref: "#/components/schemas/CustomerStatus" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CustomerCreate: {
        type: "object",
        required: ["fiscalCode", "firstName", "lastName", "email", "phone"],
        properties: {
          fiscalCode: { type: "string", example: "RSSMRA80A01H501U" },
          firstName: { type: "string", example: "Mario" },
          lastName: { type: "string", example: "Rossi" },
          email: { type: "string", format: "email", example: "mario.rossi@example.com" },
          phone: { type: "string", example: "+39 333 1234567" },
        },
      },
      CustomerUpdate: {
        type: "object",
        minProperties: 1,
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          status: { $ref: "#/components/schemas/CustomerStatus" },
        },
      },
      KycDocument: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          customerId: { type: "string", format: "uuid" },
          fileName: { type: "string", example: "carta-identita.pdf", description: "Nome originale ripulito (solo da mostrare)" },
          mimeType: { type: "string", enum: ["application/pdf", "image/jpeg", "image/png"] },
          sizeBytes: { type: "integer", example: 284133 },
          uploadedAt: { type: "string", format: "date-time" },
        },
      },

      Account: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          ownerId: { type: "string", format: "uuid" },
          iban: { type: "string", example: "IT60X0542811101000000123456" },
          type: { $ref: "#/components/schemas/AccountType" },
          balance: { $ref: "#/components/schemas/Money" },
          status: { $ref: "#/components/schemas/AccountStatus" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      AccountCreate: {
        type: "object",
        required: ["ownerId", "iban", "type"],
        properties: {
          ownerId: { type: "string", format: "uuid" },
          iban: { type: "string", example: "IT60X0542811101000000123456" },
          type: { $ref: "#/components/schemas/AccountType" },
          initialBalance: { type: "number", minimum: 0, default: 0, example: 1000 },
        },
      },
      AccountUpdate: {
        type: "object",
        minProperties: 1,
        properties: {
          ownerId: { type: "string", format: "uuid" },
          type: { $ref: "#/components/schemas/AccountType" },
          status: { $ref: "#/components/schemas/AccountStatus" },
        },
      },
      PageMeta: {
        type: "object",
        properties: {
          total: { type: "integer", example: 25 },
          page: { type: "integer", example: 3 },
          pageSize: { type: "integer", example: 10 },
          totalPages: { type: "integer", example: 3 },
        },
      },
      AccountPage: {
        type: "object",
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Account" } },
          meta: { $ref: "#/components/schemas/PageMeta" },
        },
      },

      Transfer: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          fromAccountId: { type: "string", format: "uuid" },
          toAccountId: { type: "string", format: "uuid" },
          amount: { $ref: "#/components/schemas/Money" },
          description: { type: "string", nullable: true },
          status: { type: "string", enum: ["PENDING", "COMPLETED", "FAILED"] },
          executedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      TransferCreate: {
        type: "object",
        required: ["fromIban", "toIban", "amount"],
        properties: {
          fromIban: { type: "string", example: "IT60X0542811101000000123456" },
          toIban: { type: "string", example: "IT28W8000000292100645211208" },
          amount: { type: "string", example: "100.00", description: "Positivo, massimo 2 decimali" },
          description: { type: "string", maxLength: 140, example: "Affitto ottobre" },
        },
      },
      TransferFeed: {
        type: "object",
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Transfer" } },
          meta: {
            type: "object",
            properties: { nextCursor: { type: "string", format: "uuid", nullable: true } },
          },
        },
      },

      BalanceByCustomer: {
        type: "object",
        properties: {
          ownerId: { type: "string", format: "uuid" },
          totalBalance: { $ref: "#/components/schemas/Money" },
          accountCount: { type: "integer", example: 2 },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Non autenticato (cookie access_token mancante, scaduto o non valido)",
        content: { "application/json": { schema: error("UNAUTHORIZED", "Autenticazione richiesta") } },
      },
      Forbidden: {
        description: "Autenticato ma senza il ruolo richiesto",
        content: { "application/json": { schema: error("FORBIDDEN", "Operazione non consentita") } },
      },
      NotFound: {
        description: "Risorsa inesistente (o cancellata)",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Conflict: {
        description: "Conflitto con lo stato della risorsa (duplicato, saldo insufficiente, ...)",
        content: { "application/json": { schema: error("CONFLICT", "IBAN già registrato") } },
      },
      ValidationFailed: {
        description: "Input non valido",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationError" } } },
      },
    },
  },
};

// swagger-jsdoc tipizza il risultato come `object`: lo si espone come oggetto JSON generico per swagger-ui-express
export const openApiSpec = swaggerJsdoc({
  definition,
  // .ts in sviluppo/test (tsx, ts-jest), .js dopo la build (tsc conserva i commenti JSDoc)
  apis: [glob("..", "modules", "**", "*.routes.{ts,js}"), glob("..", "app.{ts,js}")],
} as swaggerJsdoc.Options) as Record<string, unknown>;
