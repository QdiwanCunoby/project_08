// PrismaClient dell'app con soft delete automatico su Account e Customer.
//
// La traccia chiede un "middleware Prisma" (prisma.$use). $use è stato deprecato in Prisma 4.16 e RIMOSSO
// in Prisma 6: con @prisma/client 6.19 non esiste più. Il sostituto ufficiale è una Client Extension di tipo
// `query`: stessa idea (intercetta ogni operazione prima che parta), ma tipizzata e componibile.
import { Prisma, PrismaClient } from "@prisma/client";

const SOFT_DELETE_MODELS = new Set<string>(["Account", "Customer"]);

// Operazioni a cui si aggiunge `deletedAt: null` nel where:
// - letture richieste dalla traccia (findUnique/findFirst/findMany) + varianti OrThrow;
// - count/aggregate/groupBy: un report o un totale non deve contare i record cancellati;
// - update/updateMany: un PUT su un conto cancellato deve dare 404, non resuscitarlo.
//   (findUnique e update accettano campi non-unique nel where da Prisma 5: "extendedWhereUnique")
const FILTERED_OPERATIONS = new Set<string>([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "count", "aggregate", "groupBy", "update", "updateMany",
]);

export const softDeleteExtension = Prisma.defineExtension({
  name: "softDelete",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (SOFT_DELETE_MODELS.has(model) && FILTERED_OPERATIONS.has(operation)) {
          const withWhere = args as { where?: Record<string, unknown> };
          // Se chi chiama filtra già su deletedAt (es. un audit che cerca proprio i cancellati) lo si rispetta
          if (!withWhere.where || !("deletedAt" in withWhere.where)) {
            withWhere.where = { ...withWhere.where, deletedAt: null };
          }
        }
        return query(args);
      },
    },
  },
});

// Limiti da conoscere: l'estensione vede solo la query "di primo livello". Le relazioni caricate con include/select
// (es. customer.include.accounts) e le query raw NON sono filtrate: lì il filtro deletedAt va scritto a mano.

// UN SOLO client per processo (un pool di connessioni), già esteso.
// Il cast a PrismaClient: un'estensione `query` non cambia nessun tipo (stessi modelli, stessi argomenti), mentre il
// tipo del client esteso è diverso e incompatibile con i repository/service che dichiarano `PrismaClient`.
export const prisma = new PrismaClient().$extends(softDeleteExtension) as unknown as PrismaClient;
