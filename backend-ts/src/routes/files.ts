import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { getMultimediaRequestsCollection, getDigitalMediaRequestsCollection, getPrintMaterialsRequestsCollection, getRequestsCollection, isValidObjectId } from '../config/database';
import sharp from 'sharp';
import { MOV_DIR } from '../utils/movUpload';

const router = Router();

const allowedExtensions = [
  '.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx',
  '.pptx', '.mp4', '.webm', '.ps', '.eps', '.psd', '.tif', '.tiff'
];

function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ps': 'application/postscript',
    '.eps': 'application/postscript',
    '.psd': 'image/vnd.adobe.photoshop',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff'
  };
  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}

function isImageFile(ext: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.psd', '.tif', '.tiff'].includes(ext.toLowerCase());
}

function isInlineFile(ext: string): boolean {
  const inline = ext.toLowerCase();
  return isImageFile(inline) || inline === '.pdf' || inline === '.mp4' || inline === '.webm';
}

// Smaller WebP copies of photos for showing on screen: ?size=thumb for the MOV photo tiles,
// ?size=preview for the image viewer. Without it the original is sent, which is what opens in a
// new tab and what downloads. Each copy is made once (up to a few hundred ms), kept in
// PREVIEW_CACHE (outside uploads/, so backups skip it; deleting it is safe), and cached by the browser.
const PREVIEW_SIZES: Record<string, { edge: number; quality: number }> = {
  thumb: { edge: 480, quality: 70 },
  preview: { edge: 1400, quality: 75 },
};
const PREVIEWABLE = ['.jpg', '.jpeg', '.png', '.webp'];
const PREVIEW_CACHE = path.join(__dirname, '../../cache/previews');
// Browsers keep files for a day; the user's own cache only, since every file needs a login.
const BROWSER_CACHE = 'private, max-age=86400';

/** The saved copy of a file at one size, made now if missing or older than the file. */
async function previewOf(filePath: string, size: string, spec: { edge: number; quality: number }): Promise<string> {
  const key = crypto.createHash('sha1').update(`${filePath}|${size}|${spec.edge}|${spec.quality}`).digest('hex');
  const cached = path.join(PREVIEW_CACHE, `${key}.webp`);
  const [source, saved] = await Promise.all([fs.promises.stat(filePath), fs.promises.stat(cached).catch(() => null)]);
  if (saved && saved.mtimeMs >= source.mtimeMs) return cached;
  const image = await sharp(filePath)
    .rotate()
    .resize({ width: spec.edge, height: spec.edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: spec.quality })
    .toBuffer();
  await fs.promises.mkdir(PREVIEW_CACHE, { recursive: true });
  // Written under a temporary name and renamed, so a request at the same moment never reads half a file.
  const tmp = `${cached}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, image);
  await fs.promises.rename(tmp, cached);
  return cached;
}

/**
 * Deletes a request's upload folder (uploads/<folder>/<requestId>) and the saved preview copies of
 * the files in it. Returns how many files were removed; a folder that was never made is 0.
 */
export async function removeRequestFiles(folder: 'requests' | 'multimedia' | 'digitalmedia' | 'printmaterials', requestId: string): Promise<number> {
  const dir = path.join(__dirname, `../../uploads/${folder}/${requestId}`);
  const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.flatMap((name) => Object.entries(PREVIEW_SIZES).map(([size, spec]) => {
    const key = crypto.createHash('sha1').update(`${path.join(dir, name)}|${size}|${spec.edge}|${spec.quality}`).digest('hex');
    return fs.promises.rm(path.join(PREVIEW_CACHE, `${key}.webp`), { force: true });
  })));
  await fs.promises.rm(dir, { recursive: true, force: true });
  return names.length;
}

/** Sends the preview asked for and returns true; false (send the original) if none was asked for or it can't be made. */
async function sendPreview(req: AuthenticatedRequest, res: Response, filePath: string): Promise<boolean> {
  const spec = PREVIEW_SIZES[String(req.query.size || '')];
  if (!spec || !PREVIEWABLE.includes(path.extname(filePath).toLowerCase())) return false;
  try {
    const preview = await previewOf(filePath, String(req.query.size), spec);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', BROWSER_CACHE);
    fs.createReadStream(preview).pipe(res);
    return true;
  } catch {
    // Not an image sharp can read (a mislabeled file): the original is sent as before.
    console.warn(`No preview for ${path.basename(filePath)}, sending the original`);
    return false;
  }
}

async function verifyAccess(requestId: string, userId: string, userRoles: string[], collection: 'multimedia' | 'digitalmedia' | 'printmaterials'): Promise<boolean> {
  try {
    if (userRoles.includes('ADMIN') || userRoles.includes('MULTIMEDIA_ADMIN')) return true;

    let collectionGetter;
    switch (collection) {
      case 'multimedia':
        collectionGetter = getMultimediaRequestsCollection;
        break;
      case 'digitalmedia':
        collectionGetter = getDigitalMediaRequestsCollection;
        break;
      case 'printmaterials':
        collectionGetter = getPrintMaterialsRequestsCollection;
        break;
    }

    const reqCollection = collectionGetter();
    const request = await reqCollection.findOne({ _id: new ObjectId(requestId) });

    if (!request) return false;

    if (userRoles.includes('CLIENT') && request.created_by?.toString() === userId) return true;

    if (request.assigned_to?.toString() === userId) return true;

    if ((request as any).shared_access?.some((id: any) => id.toString() === userId)) return true;

    return false;
  } catch {
    return false;
  }
}

// MOV photos of an IT request (utils/movUpload.ts): for IT admins, the super admin, whoever handled
// it, and the client who filed it or anyone they shared it with.
router.get('/requests/:requestId/:filename', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId, filename } = req.params;
    const ext = path.extname(filename).toLowerCase();
    // WebP since photos are converted on upload; .jpg/.png for MOVs sent before that.
    if (!isValidObjectId(requestId) || !['.webp', '.jpg', '.jpeg', '.png'].includes(ext)) {
      return res.status(400).json({ error: 'Invalid file' });
    }

    const roles = req.user!.roles;
    if (!roles.includes('IT_ADMIN') && !roles.includes('ADMIN')) {
      const uid = new ObjectId(req.user!.user_id);
      const request = await getRequestsCollection().findOne(
        { _id: new ObjectId(requestId), $or: [{ created_by: uid }, { assigned_to: uid }, { shared_access: uid }, { 'mov.submitted_by': uid }] },
        { projection: { _id: 1 } }
      );
      if (!request) return res.status(403).json({ error: 'You do not have access to this file' });
    }

    const filePath = path.join(MOV_DIR, requestId, path.basename(filename));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (await sendPreview(req, res, filePath)) return;
    res.setHeader('Cache-Control', BROWSER_CACHE);

    res.setHeader('Content-Type', getMimeType(ext));
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filename)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('Error serving MOV photo:', error);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

router.get('/multimedia/:requestId/:filename', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId, filename } = req.params;
    const roles = req.user!.roles;

    if (!roles.includes('MULTIMEDIA') && !roles.includes('ADMIN') && !roles.includes('CLIENT') && !roles.includes('MULTIMEDIA_ADMIN')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!isValidObjectId(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const hasAccess = await verifyAccess(requestId, req.user!.user_id, roles, 'multimedia');
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this file' });
    }

    const ext = path.extname(filename).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return res.status(400).json({ error: 'File type not allowed' });
    }

    const safeFilename = path.basename(filename);
    const filePath = path.join(__dirname, `../../uploads/multimedia/${requestId}/${safeFilename}`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (await sendPreview(req, res, filePath)) return;
    res.setHeader('Cache-Control', BROWSER_CACHE);

    const mimeType = getMimeType(ext);
    const fileName = Buffer.from(safeFilename, 'latin1').toString('utf8');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', isInlineFile(ext)
      ? `inline; filename="${fileName}"` 
      : `attachment; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error serving multimedia file:', error);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

router.get('/digitalmedia/:requestId/:filename', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId, filename } = req.params;
    const roles = req.user!.roles;

    if (!roles.includes('MULTIMEDIA') && !roles.includes('ADMIN') && !roles.includes('CLIENT') && !roles.includes('MULTIMEDIA_ADMIN')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!isValidObjectId(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const hasAccess = await verifyAccess(requestId, req.user!.user_id, roles, 'digitalmedia');
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this file' });
    }

    const ext = path.extname(filename).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return res.status(400).json({ error: 'File type not allowed' });
    }

    const safeFilename = path.basename(filename);
    const filePath = path.join(__dirname, `../../uploads/digitalmedia/${requestId}/${safeFilename}`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (await sendPreview(req, res, filePath)) return;
    res.setHeader('Cache-Control', BROWSER_CACHE);

    const mimeType = getMimeType(ext);
    const fileName = Buffer.from(safeFilename, 'latin1').toString('utf8');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', isInlineFile(ext)
      ? `inline; filename="${fileName}"` 
      : `attachment; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error serving digital media file:', error);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

router.get('/printmaterials/:requestId/:filename', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId, filename } = req.params;
    const roles = req.user!.roles;

    if (!roles.includes('MULTIMEDIA') && !roles.includes('ADMIN') && !roles.includes('CLIENT') && !roles.includes('MULTIMEDIA_ADMIN')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!isValidObjectId(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const hasAccess = await verifyAccess(requestId, req.user!.user_id, roles, 'printmaterials');
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have access to this file' });
    }

    const ext = path.extname(filename).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return res.status(400).json({ error: 'File type not allowed' });
    }

    const safeFilename = path.basename(filename);
    const filePath = path.join(__dirname, `../../uploads/printmaterials/${requestId}/${safeFilename}`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (await sendPreview(req, res, filePath)) return;
    res.setHeader('Cache-Control', BROWSER_CACHE);

    const mimeType = getMimeType(ext);
    const fileName = Buffer.from(safeFilename, 'latin1').toString('utf8');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', isInlineFile(ext)
      ? `inline; filename="${fileName}"` 
      : `attachment; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error serving print materials file:', error);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

export default router;
