// Route: connette URL → Controller. Le dipendenze arrivano dal composition root (app.ts).
import { Router } from "express";
import { CustomerController } from "./customer.controller";
import { createCustomerSchema, updateCustomerSchema } from "./customer.types";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/authorize";

export const createCustomerRoutes = (controller: CustomerController): Router => {
  const router = Router();

  /**
   * @openapi
   * /api/customers:
   *   get:
   *     tags: [Customers]
   *     summary: Lista clienti (esclusi quelli cancellati)
   *     responses:
   *       200:
   *         description: Clienti
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { type: array, items: { $ref: "#/components/schemas/Customer" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   */
  router.get("/", controller.getAll);

  /**
   * @openapi
   * /api/customers/{id}:
   *   get:
   *     tags: [Customers]
   *     summary: Dettaglio cliente
   *     parameters:
   *       - { $ref: "#/components/parameters/IdPath" }
   *     responses:
   *       200:
   *         description: Il cliente
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/Customer" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       404: { $ref: "#/components/responses/NotFound" }
   */
  router.get("/:id", controller.getById);

  /**
   * @openapi
   * /api/customers:
   *   post:
   *     tags: [Customers]
   *     summary: Registra un cliente
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: "#/components/schemas/CustomerCreate" }
   *     responses:
   *       201:
   *         description: Cliente creato
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/Customer" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       409: { $ref: "#/components/responses/Conflict" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.post("/", validate(createCustomerSchema), controller.create);

  /**
   * @openapi
   * /api/customers/{id}:
   *   put:
   *     tags: [Customers]
   *     summary: Aggiorna anagrafica o stato (il codice fiscale non si modifica)
   *     parameters:
   *       - { $ref: "#/components/parameters/IdPath" }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: "#/components/schemas/CustomerUpdate" }
   *     responses:
   *       200:
   *         description: Cliente aggiornato
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/Customer" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       404: { $ref: "#/components/responses/NotFound" }
   *       409: { $ref: "#/components/responses/Conflict" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.put("/:id", validate(updateCustomerSchema), controller.update);

  /**
   * @openapi
   * /api/customers/{id}:
   *   delete:
   *     tags: [Customers]
   *     summary: Cancella un cliente (soft delete, solo ADMIN)
   *     description: Rifiutato con 409 se il cliente ha ancora conti attivi.
   *     parameters:
   *       - { $ref: "#/components/parameters/IdPath" }
   *     responses:
   *       204: { description: Cliente cancellato }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       403: { $ref: "#/components/responses/Forbidden" }
   *       404: { $ref: "#/components/responses/NotFound" }
   *       409: { $ref: "#/components/responses/Conflict" }
   */
  router.delete("/:id", authorize("ADMIN"), controller.delete);

  return router;
};
