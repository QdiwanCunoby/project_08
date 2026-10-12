// Unit test KycService: customers, repository, storage e rilevamento del tipo sono mock iniettati (nessun DB, nessun disco)
import { KycDocument } from "@prisma/client";
import { KycService, sanitizeFileName } from "./kyc.service";
import { IKycRepository } from "./kyc.repository";
import { KycStorage } from "./kyc.storage";
import { UploadedFile } from "./kyc.types";
import { ICustomerRepository } from "../customer/customer.repository";
import { NotFoundError, ValidationError } from "../../utils/errors";

const CUSTOMER_ID = "0b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const PDF: UploadedFile = { buffer: Buffer.from("%PDF-1.7"), mimetype: "application/pdf", originalname: "carta-identita.pdf", size: 8 };

const setup = (detected: { mime: string } | undefined = { mime: "application/pdf" }) => {
  const customers = { findById: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }) } as unknown as jest.Mocked<ICustomerRepository>;
  const documents: jest.Mocked<IKycRepository> = {
    create: jest.fn(async data => ({ id: "doc-1", uploadedAt: new Date(0), ...data }) as KycDocument),
  };
  const storage: jest.Mocked<KycStorage> = {
    save: jest.fn().mockResolvedValue("uploads/kyc/abc.pdf"),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const detect = jest.fn().mockResolvedValue(detected);
  return { service: new KycService(customers, documents, storage, detect), customers, documents, storage, detect };
};

describe("KycService.upload", () => {
  it("contenuto coerente con il MIME → salva il file con l'estensione della whitelist e registra il documento", async () => {
    // Arrange
    const { service, documents, storage } = setup();

    // Act
    const result = await service.upload(CUSTOMER_ID, PDF);

    // Assert
    expect(storage.save).toHaveBeenCalledWith(PDF.buffer, ".pdf");
    expect(documents.create).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID, fileName: "carta-identita.pdf", mimeType: "application/pdf", sizeBytes: 8, storageUrl: "uploads/kyc/abc.pdf",
    });
    expect(result).not.toHaveProperty("storageUrl");   // dettaglio interno, non esposto
  });

  it("magic number diverso dal MIME dichiarato (exe spacciato per PDF) → ValidationError, niente salvato", async () => {
    const { service, storage, documents } = setup({ mime: "application/x-msdownload" });

    await expect(service.upload(CUSTOMER_ID, PDF)).rejects.toBeInstanceOf(ValidationError);
    expect(storage.save).not.toHaveBeenCalled();
    expect(documents.create).not.toHaveBeenCalled();
  });

  it("formato non riconoscibile (file-type → undefined) → ValidationError", async () => {
    const { service } = setup(undefined);
    await expect(service.upload(CUSTOMER_ID, { ...PDF, buffer: Buffer.from("testo qualunque") })).rejects.toMatchObject({
      statusCode: 422, details: [expect.objectContaining({ field: "file" })],
    });
  });

  it("cliente inesistente (o cancellato) → NotFoundError, il file non viene nemmeno analizzato", async () => {
    const { service, customers, detect } = setup();
    customers.findById.mockResolvedValue(null);

    await expect(service.upload(CUSTOMER_ID, PDF)).rejects.toBeInstanceOf(NotFoundError);
    expect(detect).not.toHaveBeenCalled();
  });

  it("INSERT fallito dopo il salvataggio → il file viene rimosso (nessun orfano) e l'errore risale", async () => {
    const { service, documents, storage } = setup();
    documents.create.mockRejectedValue(new Error("DB down"));

    await expect(service.upload(CUSTOMER_ID, PDF)).rejects.toThrow("DB down");
    expect(storage.remove).toHaveBeenCalledWith("uploads/kyc/abc.pdf");
  });
});

describe("sanitizeFileName", () => {
  it.each([
    ["../../../etc/passwd.pdf", "passwd.pdf"],
    ["C:\\Users\\mario\\documento.png", "documento.png"],
    ["fattura\u0000.pdf\n", "fattura.pdf"],
    ["", "documento"],
    ["../", "documento"],
  ])("%j → %j", (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it("tronca a 255 caratteri", () => {
    expect(sanitizeFileName("a".repeat(300) + ".pdf")).toHaveLength(255);
  });
});
