// Repository: unico punto che sa DOVE stanno i dati. Due implementazioni della stessa interfaccia:
// InMemoryAccountRepository (G2-G4) e PrismaAccountRepository (G5): si scambiano nel composition root.
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, Account as AccountRow } from "@prisma/client";
import { ConflictError } from "../../utils/errors";
import { isPrismaError } from "../../utils/prismaErrors";
import { Account, AccountStatus, CreateAccountDto, ListAccountsQuery, UpdateAccountDto } from "./account.types";

// Una pagina + il totale delle righe che rispettano i filtri nell'intero dataset
export interface AccountPage { items: Account[]; total: number }

export interface IAccountRepository {
  findAll(): Promise<Account[]>;
  findPaginated(query: ListAccountsQuery): Promise<AccountPage>;
  findById(id: string): Promise<Account | null>;
  findByIban(iban: string): Promise<Account | null>;
  create(dto: CreateAccountDto): Promise<Account>;
  update(id: string, dto: UpdateAccountDto): Promise<Account | null>;
  // Soft delete: true se il conto esisteva (e non era già cancellato)
  delete(id: string): Promise<boolean>;
}

export class InMemoryAccountRepository implements IAccountRepository {
  private accounts: Account[] = [];

  async findAll(): Promise<Account[]> { return [...this.accounts]; }

  async findPaginated(query: ListAccountsQuery): Promise<AccountPage> {
    const sortValue = (a: Account): string | number =>
      query.sortBy === "balance" ? Number(a.balance) : query.sortBy === "iban" ? a.iban : a.createdAt.getTime();
    const direction = query.order === "asc" ? 1 : -1;
    const matching = this.accounts
      .filter(a => (!query.status || a.status === query.status) && (!query.type || a.type === query.type))
      .sort((a, b) => {
        const x = sortValue(a), y = sortValue(b);
        return (x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id)) * direction;
      });
    const start = (query.page - 1) * query.pageSize;
    return { items: matching.slice(start, start + query.pageSize), total: matching.length };
  }

  async findById(id: string): Promise<Account | null> {
    return this.accounts.find(a => a.id === id) ?? null;
  }

  async findByIban(iban: string): Promise<Account | null> {
    return this.accounts.find(a => a.iban === iban) ?? null;
  }

  async create(dto: CreateAccountDto): Promise<Account> {
    const { initialBalance, ...data } = dto;
    const account: Account = {
      id: randomUUID(), ...data,
      balance: initialBalance.toFixed(2),
      status: AccountStatus.ACTIVE, createdAt: new Date(), updatedAt: new Date(),
    };
    this.accounts.push(account);
    return account;
  }

  async update(id: string, dto: UpdateAccountDto): Promise<Account | null> {
    const index = this.accounts.findIndex(a => a.id === id);
    if (index === -1) return null;
    // Scarta i campi undefined: altrimenti lo spread cancellerebbe i valori esistenti
    const changes = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    this.accounts[index] = { ...this.accounts[index], ...changes };
    return this.accounts[index];
  }

  // Test double: rimuove dalla lista (lato API l'effetto è lo stesso del soft delete: il conto non si vede più)
  async delete(id: string): Promise<boolean> {
    const index = this.accounts.findIndex(a => a.id === id);
    if (index === -1) return false;
    this.accounts.splice(index, 1);
    return true;
  }
}

// Riga Prisma → tipo di dominio: il Decimal esce come stringa ("1000.00"), l'enum Prisma ha gli stessi valori.
// deletedAt non viene esposto: un conto cancellato non arriva mai fin qui (filtro dell'estensione soft delete).
const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  ownerId: row.ownerId,
  iban: row.iban,
  type: row.type as Account["type"],
  balance: row.balance.toFixed(2),
  status: row.status as AccountStatus,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class PrismaAccountRepository implements IAccountRepository {
  // `prisma` è il client esteso con il soft delete (src/config/prisma.ts): tutte le query qui sotto
  // ricevono in automatico `deletedAt: null` nel where
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<Account[]> {
    const rows = await this.prisma.account.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(toAccount);
  }

  async findPaginated(query: ListAccountsQuery): Promise<AccountPage> {
    const where: Prisma.AccountWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    // Pagina e totale nella stessa transazione, con lo stesso where: total è il conteggio del dataset filtrato.
    // Ordine totale: sortBy (dalla whitelist Zod) + id come spareggio, altrimenti a parità di valore
    // (stesso saldo, stesso createdAt) Postgres può restituire righe ripetute o saltate tra le pagine.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.account.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.order }, { id: query.order }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.account.count({ where }),
    ]);
    return { items: rows.map(toAccount), total };
  }

  async findById(id: string): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({ where: { id } });
    return row && toAccount(row);
  }

  async findByIban(iban: string): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({ where: { iban } });
    return row && toAccount(row);
  }

  async create(dto: CreateAccountDto): Promise<Account> {
    const { initialBalance, ...data } = dto;
    try {
      const row = await this.prisma.account.create({
        data: { ...data, balance: new Prisma.Decimal(initialBalance) },
      });
      return toAccount(row);
    } catch (e) {
      // ownerId che non esiste: la FK lo rifiuta
      if (isPrismaError(e, "P2003")) throw new ConflictError("ownerId non corrisponde a nessun cliente");
      // IBAN già usato, anche da un conto cancellato: in banca un IBAN non si riassegna (unique resta sul DB)
      if (isPrismaError(e, "P2002")) throw new ConflictError("IBAN già registrato");
      throw e;
    }
  }

  async update(id: string, dto: UpdateAccountDto): Promise<Account | null> {
    try {
      // I campi undefined sono ignorati da Prisma: non serve filtrarli
      const row = await this.prisma.account.update({ where: { id }, data: dto });
      return toAccount(row);
    } catch (e) {
      if (isPrismaError(e, "P2025")) return null;   // non trovato (o già cancellato)
      if (isPrismaError(e, "P2003")) throw new ConflictError("ownerId non corrisponde a nessun cliente");
      throw e;
    }
  }

  // Soft delete: niente DELETE fisico. La riga resta (con i bonifici che la referenziano), deletedAt la nasconde.
  // L'estensione aggiunge `deletedAt: null` al where: cancellare due volte lo stesso conto → P2025 → 404.
  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.account.update({ where: { id }, data: { deletedAt: new Date() } });
      return true;
    } catch (e) {
      if (isPrismaError(e, "P2025")) return false;
      throw e;
    }
  }
}
