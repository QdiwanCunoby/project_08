// SSE (Server-Sent Events) con un servizio AI SIMULATO: nel bootcamp non c'è un LLM vero, quindi lo stream
// emette 5 chunk fittizi a 500ms di distanza e poi `data: [DONE]`. Il formato è quello di un proxy reale:
// sostituendo il timer con il body di una fetch verso il servizio AI, il client non nota differenze.
//   curl -N "http://localhost:3000/api/ai/stream?q=hello" --cookie "access_token=..."
import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate";

export const aiStreamQuerySchema = z.object({
  q: z.string({ message: "q obbligatorio" }).trim().min(1, { message: "q obbligatorio" }).max(500),
});

type AiStreamQuery = z.infer<typeof aiStreamQuerySchema>;

export interface AiStreamOptions {
  chunkIntervalMs?: number;   // default 500 (i test lo abbassano per non aspettare 2.5s)
}

const CHUNK_COUNT = 5;

// Risposta finta in 5 pezzi, come i token di un LLM
const mockAnswer = (question: string): string[] => [
  `Ho ricevuto la tua domanda: "${question}".`,
  " Sto consultando i dati del tuo conto LipariBank...",
  " Il saldo disponibile è aggiornato all'ultimo movimento contabilizzato.",
  " Per bonifici sopra i 15.000 € è prevista una verifica aggiuntiva.",
  " Posso aiutarti con altro?",
];

export const createAiRoutes = ({ chunkIntervalMs = 500 }: AiStreamOptions = {}): Router => {
  const router = Router();

  /**
   * @openapi
   * /api/ai/stream:
   *   get:
   *     tags: [AI]
   *     summary: Risposta dell'assistente AI in streaming (Server-Sent Events, servizio simulato)
   *     description: |
   *       Emette 5 eventi `data: {"index", "text"}` a distanza di 500ms, poi `data: [DONE]`.
   *       Lato browser: `new EventSource("/api/ai/stream?q=...", { withCredentials: true })`.
   *     parameters:
   *       - { in: query, name: q, required: true, schema: { type: string, minLength: 1, maxLength: 500 }, example: hello }
   *     responses:
   *       200:
   *         description: Stream di eventi SSE
   *         content:
   *           text/event-stream:
   *             schema: { type: string }
   *             example: "data: {\"index\":0,\"text\":\"Ho ricevuto...\"}\n\n...\ndata: [DONE]\n\n"
   *       401: { $ref: "#/components/responses/Unauthorized" }
   *       422: { $ref: "#/components/responses/ValidationFailed" }
   */
  router.get("/stream", validate(aiStreamQuerySchema, "query"), (req, res) => {
    const { q } = req.query as unknown as AiStreamQuery;

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",          // nessun proxy/browser deve mettere in cache uno stream
      Connection: "keep-alive",             // la connessione resta aperta per tutti gli eventi
      "X-Accel-Buffering": "no",            // nginx: niente buffering, ogni chunk parte subito
    });
    res.flushHeaders();                     // header inviati ORA: il client vede lo stream aperto prima del primo chunk

    const chunks = mockAnswer(q);
    let sent = 0;

    const timer = setInterval(() => {
      // JSON.stringify: un "\n" dentro il testo spezzerebbe il frame SSE (gli eventi sono separati da riga vuota)
      res.write(`data: ${JSON.stringify({ index: sent, text: chunks[sent] })}\n\n`);
      sent++;
      if (sent === CHUNK_COUNT) {
        clearInterval(timer);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }, chunkIntervalMs);

    // Client andato via (tab chiusa, EventSource.close()): si ferma il timer. Con un servizio AI vero qui si fa
    // abort() della fetch upstream, altrimenti la connessione verso l'LLM resta aperta (fd leak).
    // res.on e non req.on: da Node 16 `req` emette "close" quando il body è stato letto, non alla disconnessione.
    res.on("close", () => clearInterval(timer));
  });

  return router;
};

export { CHUNK_COUNT };
