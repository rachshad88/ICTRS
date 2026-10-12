import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { validateFileMagicBytes, mimeTypeForFilename } from './fileValidation';

// MOV (means of verification): the photos a technician attaches when finishing an IT request, which
// an IT admin checks before the request counts as done (routes/requests.ts). Stored per request in
// uploads/requests/<request id>/, served by routes/files.ts.

export const MOV_DIR = path.join(__dirname, '../../uploads/requests');
export const MOV_MIN_FILES = 1;
export const MOV_MAX_FILES = 3;
const MOV_MIME_TYPES = ['image/jpeg', 'image/png'];
const TEMP_DIR = path.join(MOV_DIR, 'tmp');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    cb(null, TEMP_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const mimeType = mimeTypeForFilename(file.originalname);
  if (mimeType && MOV_MIME_TYPES.includes(mimeType)) cb(null, true);
  else cb(new Error(`"${file.originalname}" is not a photo. Attach JPG or PNG images.`));
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024, files: MOV_MAX_FILES } })
  .array('photos', MOV_MAX_FILES);

/** Receives the MOV photos (form field "photos"); a bad file or too many answer 400. */
export function receiveMovPhotos(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    const tooMany = err instanceof multer.MulterError && (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE');
    const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    const message = tooMany
      ? `Attach at most ${MOV_MAX_FILES} photos.`
      : tooBig
        ? 'Each photo must be 10 MB or smaller.'
        : err instanceof Error ? err.message : 'Photo upload failed';
    res.status(400).json({ status: 'error', message });
  });
}

export function uploadedMovPhotos(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

/** Deletes received photos that were not kept (rejected or failed submissions). */
export function discardMovPhotos(files: Express.Multer.File[]): void {
  for (const f of files) {
    try { fs.unlinkSync(f.path); } catch {}
  }
}

/** The first photo whose content is not really a JPG/PNG, or null when all are fine. */
export function invalidMovPhoto(files: Express.Multer.File[]): string | null {
  const bad = files.find((f) => !validateFileMagicBytes(f.path, mimeTypeForFilename(f.originalname) || ''));
  return bad ? bad.originalname : null;
}

/** Moves the photos into the request's folder and returns their stored file names. */
export function keepMovPhotos(files: Express.Multer.File[], requestId: string): string[] {
  const dir = path.join(MOV_DIR, requestId);
  fs.mkdirSync(dir, { recursive: true });
  return files.map((f) => {
    fs.renameSync(f.path, path.join(dir, f.filename));
    return f.filename;
  });
}

/** Removes kept photos again, when saving the submission failed after they were moved. */
export function removeKeptMovPhotos(names: string[], requestId: string): void {
  for (const name of names) {
    try { fs.unlinkSync(path.join(MOV_DIR, requestId, name)); } catch {}
  }
}
