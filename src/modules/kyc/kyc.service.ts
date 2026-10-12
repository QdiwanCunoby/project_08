// Upload documenti KYC. Due livelli di controllo sul tipo di file:
//  1. multer fileFilter (middleware/kycUpload.ts): il MIME DICHIARATO deve essere in whitelist → altrimenti 415
//  2. qui: magic number con file-type sul CONTENUTO reale. Se non coincide con il MIME dichiarato → ValidationError (422).
//     Il MIME è un header scelto dal client e l'estensione è parte del nome: rinominare malware.exe in id.pdf
//     e dichiararlo application/pdf supera il punto 1, non il punto 2.
import { fromBuffer } from "file-type";
import { KycDocument } from "@prisma/client";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { ICustomerRepository } from "../customer/customer.repository";
import { IKycRepository } from "./kyc.repository";
import { KycStorage } from "./kyc.storage";
import { KYC_MIME_TYPES, KycDocumentDto, UploadedFile, isKycMimeType } from "./kyc.types";

// Firma di file-type.fromBuffer: iniettabile per gli unit test
export type DetectFileType = (buffer: Buffer) => Promise<{ mime: string } | undefined>;

// Il nome originale si conserva solo per mostrarlo: niente directory, niente caratteri di controllo, max 255
export const sanitizeFileName = (name: string): string => {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return clean || "documento";
};

const toDto = ({ id, customerId, fileName, mimeType, sizeBytes, uploadedAt }: KycDocument): KycDocumentDto =>
  ({ id, customerId, fileName, mimeType, sizeBytes, uploadedAt });

export class KycService {
  constructor(
    private readonly customers: ICustomerRepository,
    private readonly documents: IKycRepository,
    private readonly storage: KycStorage,
    private readonly detect: DetectFileType = fromBuffer,
  ) {}

  async upload(customerId: string, file: UploadedFile): Promise<KycDocumentDto> {
    // Il cliente deve esistere e non essere cancellato (findById passa dal filtro soft delete)
    if (!(await this.customers.findById(customerId))) {
      throw new NotFoundError("Customer con id " + customerId + " non trovato");
    }

    // Magic number: file-type legge i primi byte del contenuto (es. "%PDF-", "\x89PNG", FF D8 FF)
    const detected = await this.detect(file.buffer);
    if (!detected || detected.mime !== file.mimetype || !isKycMimeType(detected.mime)) {
      throw new ValidationError("Il contenuto del file non corrisponde al tipo dichiarato", [{
        field: "file",
        message: `Dichiarato ${file.mimetype}, rilevato ${detected?.mime ?? "formato sconosciuto"}`,
      }]);
    }

    // Prima il file, poi la riga. Se l'INSERT fallisce si cancella il file: niente file orfani nello storage.
    // (L'ordine inverso lascerebbe righe che puntano a file inesistenti, peggio per un audit.)
    const storageUrl = await this.storage.save(file.buffer, KYC_MIME_TYPES[detected.mime]);
    try {
      const document = await this.documents.create({
        customerId,
        fileName: sanitizeFileName(file.originalname),
        mimeType: detected.mime,
        sizeBytes: file.size,
        storageUrl,
      });
      return toDto(document);
    } catch (e) {
      await this.storage.remove(storageUrl).catch(() => undefined);
      throw e;
    }
  }
}
