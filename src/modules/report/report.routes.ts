import { Router } from "express";
import { ReportService } from "./report.service";
import { authorize } from "../../middleware/authorize";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/apiResponse";

export const createReportRoutes = (service: ReportService): Router => {
  const router = Router();

  // Dati aggregati di tutti i clienti: solo personale della banca
  router.use(authorize("ADMIN", "OPERATOR"));

  /**
   * @openapi
   * /api/reports/balance-by-customer:
   *   get:
   *     tags: [Reports]
   *     summary: Saldo totale e numero di conti ATTIVI per cliente (solo ADMIN / OPERATOR)
   *     description: Aggregazione groupBy su Postgres. Esclusi conti bloccati, chiusi e cancellati. Ordinato per saldo decrescente.
   *     responses:
   *       200:
   *         description: Una riga per cliente con almeno un conto attivo
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items: { $ref: "#/components/schemas/BalanceByCustomer" }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       403: { $ref: "#/components/responses/Forbidden" }
   */
  router.get("/balance-by-customer", asyncHandler(async (_req, res) => {
    res.status(200).json(ok(await service.balanceByCustomer()));
  }));

  return router;
};
