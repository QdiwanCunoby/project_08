// Repository Transfer: i metodi di scrittura ricevono il client della transazione ($transaction),
// così il Service decide quali operazioni appartengono alla stessa unità atomica.
import { Prisma, PrismaClient } from "@prisma/client";
import { Transfer, TransferFeed, TransferFeedQuery } from "./transfer.types";

export interface ITransferRepository {
  create(tx: Prisma.TransactionClient, data: Prisma.TransferUncheckedCreateInput): Promise<Transfer>;
  findById(id: string): Promise<Transfer | null>;
  findFeed(query: TransferFeedQuery): Promise<TransferFeed>;
}

export class PrismaTransferRepository implements ITransferRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(tx: Prisma.TransactionClient, data: Prisma.TransferUncheckedCreateInput): Promise<Transfer> {
    return tx.transfer.create({ data }) as Promise<Transfer>;
  }

  findById(id: string): Promise<Transfer | null> {
    return this.prisma.transfer.findUnique({ where: { id } }) as Promise<Transfer | null>;
  }

  // Cursor pagination: "i `limit` movimenti che vengono DOPO questo id nell'ordinamento".
  // A differenza dell'offset, i bonifici nuovi che arrivano in cima al feed mentre l'utente scorre non spostano
  // le pagine successive (niente duplicati), e Postgres parte dal cursore sull'indice invece di scartare N righe.
  async findFeed({ accountId, cursor, limit }: TransferFeedQuery): Promise<TransferFeed> {
    const rows = await this.prisma.transfer.findMany({
      where: accountId ? { OR: [{ fromAccountId: accountId }, { toAccountId: accountId }] } : undefined,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,   // Prisma include la riga del cursore: la si salta
      // Ordine TOTALE: due bonifici eseguiti nello stesso istante avrebbero posizione ambigua e il cursore potrebbe
      // saltarne uno; l'id fa da spareggio (stesso ordine dell'indice transfers_executed_at_id_idx)
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
      // Una riga in più per sapere se esiste una pagina successiva: con "nextCursor se data.length === limit"
      // un feed di esattamente `limit` movimenti farebbe chiedere al frontend una pagina vuota
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows) as Transfer[];
    return { data, meta: { nextCursor: hasMore ? data[data.length - 1].id : null } };
  }
}
