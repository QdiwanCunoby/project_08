// Route: connette URL → Controller. Le dipendenze arrivano dal composition root (app.ts).
// I blocchi @openapi sono letti da swagger-jsdoc (src/docs/openapi.ts) per generare /api-docs.
import { Router } from "express";
import { AccountController } from "./account.controller";
import { createAccountSchema, listAccountsQuerySchema, updateAccountSchema } from "./account.types";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/authorize";

export const createAccountRoutes = (controller: AccountController): Router => {
  const router = Router();

  /**
   * @openapi
   * /api/accounts:
   *   get:
   *     tags: [Accounts]
   *     summary: Lista conti paginata, filtrabile e ordinabile
   *     description: Paginazione offset. `sortBy` accetta solo i campi in whitelist. I conti cancellati (soft delete) non compaiono.
   *     parameters:
   *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
   *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
   *       - { in: query, name: status, schema: { $ref: "#/components/schemas/AccountStatus" } }
   *       - { in: query, name: type, schema: { $ref: "#/components/schemas/AccountType" } }
   *       - { in: query, name: sortBy, schema: { type: string, enum: [createdAt, balance, iban], default: createdAt } }
   *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
   *     responses:
   *       200:
   *         description: Pagina di conti
   *         content:
   *           application/json:
   *             schema: { $ref: "#/components/schemas/AccountPage" }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.get("/", validate(listAccountsQuerySchema, "query"), controller.getAll);

  /**
   * @openapi
   * /api/accounts/{id}:
   *   get:
   *     tags: [Accounts]
   *     summary: Dettaglio conto
   *     parameters:
   *       - { $ref: "#/components/parameters/IdPath" }
   *     responses:
   *       200:
   *         description: Il conto
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/Account" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       404: { $ref: "#/components/responses/NotFound" }
   */
  router.get("/:id", controller.getById);

  /**
   * @openapi
   * /api/accounts:
   *   post:
   *     tags: [Accounts]
   *     summary: Apre un conto
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: "#/components/schemas/AccountCreate" }
   *     responses:
   *       201:
   *         description: Conto creato
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/Account" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       409: { $ref: "#/components/responses/Conflict" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.post("/", validate(createAccountSchema), controller.create);

  /**
   * @openapi
   * /api/accounts/{id}:
   *   put:
   *     tags: [Accounts]
   *     summary: Aggiorna intestatario, tipo o stato (IBAN e saldo non si modificano)
   *     parameters:
   *       - { $ref: "#/components/parameters/IdPath" }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: "#/components/schemas/AccountUpdate" }
   *     responses:
   *       200:
   *         description: Conto aggiornato
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/Account" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       404: { $ref: "#/components/responses/NotFound" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.put("/:id", validate(updateAccountSchema), controller.update);

  /**
   * @openapi
   * /api/accounts/{id}:
   *   delete:
   *     tags: [Accounts]
   *     summary: Cancella un conto (soft delete, solo ADMIN)
   *     description: Non elimina la riga, valorizza `deletedAt`. Il conto sparisce dalle API, lo storico dei bonifici resta.
   *     parameters:
   *       - { $ref: "#/components/parameters/IdPath" }
   *     responses:
   *       204: { description: Conto cancellato }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       403: { $ref: "#/components/responses/Forbidden" }
   *       404: { $ref: "#/components/responses/NotFound" }
   */
  router.delete("/:id", authorize("ADMIN"), controller.delete);

  return router;
};
