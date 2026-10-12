// Controller: converte HTTP ↔ business logic. Non contiene logica né try/catch:
// gli errori lanciati dal Service arrivano all'errorHandler tramite asyncHandler.
import { Request, Response } from "express";
import { AccountService } from "./account.service";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/apiResponse";
import { ListAccountsQuery } from "./account.types";

export class AccountController {
  constructor(private readonly service: AccountService) {}

  // req.query è già validato e convertito da validate(listAccountsQuerySchema, "query")
  getAll = asyncHandler(async (req: Request, res: Response) => {
    const page = await this.service.listAccounts(req.query as unknown as ListAccountsQuery);
    res.status(200).json(page);   // { data: Account[], meta: { total, page, pageSize, totalPages } }
  });

  getById = asyncHandler(async (req: Request, res: Response) => {
    const account = await this.service.getAccountById(req.params.id);
    res.status(200).json(ok(account));
  });

  // req.body è già validato e ripulito da validate(createAccountSchema)
  create = asyncHandler(async (req: Request, res: Response) => {
    const account = await this.service.createAccount(req.body);
    res.status(201).json(ok(account));
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const account = await this.service.updateAccount(req.params.id, req.body);
    res.status(200).json(ok(account));
  });

  delete = asyncHandler(async (req: Request, res: Response) => {
    await this.service.deleteAccount(req.params.id);
    res.status(204).send();
  });
}
