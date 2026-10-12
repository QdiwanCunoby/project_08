import { z } from "zod";

// MIME ammessi → estensione con cui il file viene salvato. Unica fonte di verità per filtro multer e storage.
export const KYC_MIME_TYPES = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
} as const;

export type KycMimeType = keyof typeof KYC_MIME_TYPES;

export const isKycMimeType = (mime: string): mime is KycMimeType => Object.hasOwn(KYC_MIME_TYPES, mime);

export const KYC_MAX_FILE_SIZE = 5 * 1024 * 1024;   // 5 MB

export const kycParamsSchema = z.object({
  id: z.uuid({ message: "id cliente non valido" }),
});

// Il file come arriva da multer (memoryStorage): il service non dipende dai tipi di multer
export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;       // DICHIARATO dal client (header Content-Type della parte multipart)
  originalname: string;   // scelto dal client: solo da mostrare, mai per costruire percorsi
  size: number;
}

// Risposta API: storageUrl NON è esposto (è un dettaglio interno dello storage, un path del server)
export interface KycDocumentDto {
  id: string;
  customerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

export interface NewKycDocument {
  customerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageUrl: string;
}
