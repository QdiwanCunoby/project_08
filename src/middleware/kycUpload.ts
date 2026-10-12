// multer per i documenti KYC: memoryStorage (il file resta in un Buffer, nessuna scrittura su disco finché
// il service non ha verificato il magic number), limite 5 MB, whitelist dei MIME dichiarati.
import multer from "multer";
import { AppError } from "../utils/errors";
import { KYC_MAX_FILE_SIZE, isKycMimeType } from "../modules/kyc/kyc.types";

export const kycUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: KYC_MAX_FILE_SIZE,   // oltre → MulterError LIMIT_FILE_SIZE → 413 (errorHandler)
    files: 1,
    fields: 5,
  },
  fileFilter: (_req, file, cb) => {
    if (isKycMimeType(file.mimetype)) return cb(null, true);
    cb(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", `Tipo di file non ammesso (${file.mimetype}): solo PDF, JPEG, PNG`));
  },
});
