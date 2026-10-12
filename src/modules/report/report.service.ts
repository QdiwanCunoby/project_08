// Report aggregati: il calcolo lo fa Postgres (GROUP BY + SUM + COUNT), non Node su migliaia di righe in memoria.
import { AccountStatus, PrismaClient } from "@prisma/client";

export interface BalanceByCustomer {
  ownerId: string;
  totalBalance: string;   // importo come stringa "1500.00": mai number per i soldi
  accountCount: number;
}

export class ReportService {
  constructor(private readonly prisma: PrismaClient) {}

  // SELECT owner_id, SUM(balance), COUNT(*) FROM accounts
  // WHERE status = 'ACTIVE' AND deleted_at IS NULL GROUP BY owner_id ORDER BY SUM(balance) DESC
  // (deleted_at IS NULL lo aggiunge l'estensione soft delete anche a groupBy)
  async balanceByCustomer(): Promise<BalanceByCustomer[]> {
    const groups = await this.prisma.account.groupBy({
      by: ["ownerId"],
      where: { status: AccountStatus.ACTIVE },
      _sum: { balance: true },
      _count: { _all: true },
      orderBy: { _sum: { balance: "desc" } },
    });

    return groups.map(g => ({
      ownerId: g.ownerId,
      // _sum è un Prisma.Decimal (null solo se il gruppo non avesse righe, qui impossibile)
      totalBalance: g._sum.balance?.toFixed(2) ?? "0.00",
      accountCount: g._count._all,
    }));
  }
}
