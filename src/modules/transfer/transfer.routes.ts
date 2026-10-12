import { Router } from "express";
import { TransferController } from "./transfer.controller";
import { createTransferSchema, transferFeedQuerySchema } from "./transfer.types";
import { validate } from "../../middleware/validate";

export const createTransferRoutes = (controller: TransferController): Router => {
  const router = Router();

  /**
   * @openapi
   * /api/transfers:
   *   get:
   *     tags: [Transfers]
   *     summary: Feed movimenti (cursor pagination, più recenti prima)
   *     description: |
   *       Per la pagina successiva passare `cursor` = `meta.nextCursor` della risposta precedente.
   *       Con React Query `getNextPageParam: last => last.meta.nextCursor`. `nextCursor: null` = fine del feed.
   *     parameters:
   *       - { in: query, name: accountId, description: "Solo i movimenti in entrata o in uscita di questo conto", schema: { type: string, format: uuid } }
   *       - { in: query, name: cursor, description: "id dell'ultimo movimento ricevuto", schema: { type: string, format: uuid } }
   *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
   *     responses:
   *       200:
   *         description: Una pagina del feed
   *         content:
   *           application/json:
   *             schema: { $ref: "#/components/schemas/TransferFeed" }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.get("/", validate(transferFeedQuerySchema, "query"), controller.list);

  /**
   * @openapi
   * /api/transfers:
   *   post:
   *     tags: [Transfers]
   *     summary: Esegue un bonifico (atomico, tutto o niente)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: "#/components/schemas/TransferCreate" }
   *     responses:
   *       201:
   *         description: Bonifico eseguito
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/Transfer" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       404: { $ref: "#/components/responses/NotFound" }
   *       409: { $ref: "#/components/responses/Conflict" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.post("/", validate(createTransferSchema), controller.create);

  return router;
};
