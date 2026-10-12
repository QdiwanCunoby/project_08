// Montato su /api/customers/:id/kyc. mergeParams: senza, req.params.id del router padre non arriverebbe qui.
import { Router } from "express";
import { KycService } from "./kyc.service";
import { kycParamsSchema } from "./kyc.types";
import { validate } from "../../middleware/validate";
import { kycUpload } from "../../middleware/kycUpload";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/apiResponse";
import { ValidationError } from "../../utils/errors";

export const createKycRoutes = (service: KycService): Router => {
  const router = Router({ mergeParams: true });

  /**
   * @openapi
   * /api/customers/{id}/kyc:
   *   post:
   *     tags: [KYC]
   *     summary: Carica un documento KYC del cliente (PDF, JPEG, PNG, max 5 MB)
   *     description: |
   *       Il tipo viene verificato due volte: MIME dichiarato in whitelist (altrimenti 415) e magic number del
   *       contenuto reale (file-type). Se il contenuto non corrisponde al MIME dichiarato la risposta è 422.
   *     parameters:
   *       - { $ref: "#/components/parameters/IdPath" }
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [file]
   *             properties:
   *               file: { type: string, format: binary }
   *     responses:
   *       201:
   *         description: Documento registrato
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/KycDocument" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       404: { $ref: "#/components/responses/NotFound" }
   *       413: { description: File oltre 5 MB, content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } } }
   *       415: { description: MIME non ammesso, content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } } }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.post(
    "/",
    validate(kycParamsSchema, "params"),   // id non valido → 422 PRIMA di ricevere fino a 5 MB di file
    kycUpload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new ValidationError("File obbligatorio", [{ field: "file", message: "Allega un file nel campo 'file'" }]);
      }
      const document = await service.upload(req.params.id, req.file);
      res.status(201).json(ok(document));
    }),
  );

  return router;
};
