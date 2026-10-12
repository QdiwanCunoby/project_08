// Storage dei documenti KYC. Nel bootcamp è SIMULATO su disco locale (uploads/kyc/); in produzione la stessa
// interfaccia sarebbe implementata con Azure Blob Storage / S3 (storageUrl = URL del blob, accesso con SAS/presigned URL).
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface KycStorage {
  // Salva il contenuto e restituisce lo storageUrl da registrare nel DB
  save(content: Buffer, extension: string): Promise<string>;
  remove(storageUrl: string): Promise<void>;
}

export class LocalKycStorage implements KycStorage {
  private readonly dir: string;

  constructor(uploadDir: string) {
    this.dir = path.resolve(uploadDir, "kyc");
  }

  async save(content: Buffer, extension: string): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true });
    // Nome generato dal server: nessun dato del client nel percorso (niente path traversal, niente sovrascritture)
    const filePath = path.join(this.dir, `${randomUUID()}${extension}`);
    await fs.writeFile(filePath, content, { flag: "wx" });   // "wx": errore invece di sovrascrivere un file esistente
    // storageUrl portabile: relativo alla cwd e con "/" anche su Windows
    return path.relative(process.cwd(), filePath).split(path.sep).join("/");
  }

  async remove(storageUrl: string): Promise<void> {
    const filePath = path.resolve(storageUrl);
    // Difesa: si cancella solo dentro la cartella dello storage
    if (path.dirname(filePath) !== this.dir) throw new Error(`storageUrl fuori dallo storage KYC: ${storageUrl}`);
    await fs.rm(filePath, { force: true });
  }
}
