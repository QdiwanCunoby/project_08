import { PrismaClient, KycDocument } from "@prisma/client";
import { NewKycDocument } from "./kyc.types";

export interface IKycRepository {
  create(data: NewKycDocument): Promise<KycDocument>;
}

export class PrismaKycRepository implements IKycRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: NewKycDocument): Promise<KycDocument> {
    return this.prisma.kycDocument.create({ data });
  }
}
