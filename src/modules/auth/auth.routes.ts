// Route: connette URL → Controller. Le dipendenze arrivano dal composition root (app.ts).
import { RequestHandler, Router } from "express";
import { AuthController } from "./auth.controller";
import { loginSchema, registerSchema } from "./auth.types";
import { validate } from "../../middleware/validate";

export const createAuthRoutes = (controller: AuthController, authenticate: RequestHandler): Router => {
  const router = Router();

  /**
   * @openapi
   * /api/auth/register:
   *   post:
   *     tags: [Auth]
   *     summary: Registrazione (crea Customer + User con ruolo USER, nessun token)
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: "#/components/schemas/RegisterInput" }
   *     responses:
   *       201:
   *         description: Utente creato
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/PublicUser" } }
   *       409: { $ref: "#/components/responses/Conflict" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.post("/register", validate(registerSchema), controller.register);

  /**
   * @openapi
   * /api/auth/login:
   *   post:
   *     tags: [Auth]
   *     summary: Login → cookie HttpOnly access_token (15 min) e refresh_token (7 giorni)
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: "#/components/schemas/LoginInput" }
   *     responses:
   *       200:
   *         description: Autenticato. I token sono SOLO nei cookie (header Set-Cookie), mai nel body.
   *         headers:
   *           Set-Cookie: { schema: { type: string }, description: "access_token e refresh_token (HttpOnly, SameSite=Lax)" }
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties: { data: { $ref: "#/components/schemas/PublicUser" } }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.post("/login", validate(loginSchema), controller.login);

  /**
   * @openapi
   * /api/auth/refresh:
   *   post:
   *     tags: [Auth]
   *     summary: Nuova coppia di token (rotation, il refresh token è monouso)
   *     security: [{ refreshCookie: [] }]
   *     responses:
   *       200: { description: Nuovi cookie access_token e refresh_token }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   */
  router.post("/refresh", controller.refresh);

  /**
   * @openapi
   * /api/auth/logout:
   *   post:
   *     tags: [Auth]
   *     summary: Logout (cancella i cookie e revoca i refresh token)
   *     responses:
   *       204: { description: Sessione chiusa }
   */
  router.post("/logout", controller.logout);

  /**
   * @openapi
   * /api/auth/me:
   *   get:
   *     tags: [Auth]
   *     summary: Utente della sessione corrente
   *     responses:
   *       200:
   *         description: L'utente
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: object
   *                   properties:
   *                     id: { type: string, format: uuid }
   *                     email: { type: string, format: email }
   *                     role: { $ref: "#/components/schemas/Role" }
   *       401: { $ref: "#/components/responses/Unauthorized" }
   */
  router.get("/me", authenticate, controller.me);

  return router;
};
