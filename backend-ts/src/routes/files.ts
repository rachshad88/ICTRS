import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { ObjectId } from 'mongodb';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { getMultimediaRequestsCollection, getDigitalMediaRequestsCollection, getPrintMaterialsRequestsCollection, isValidObjectId } from '../config/database';

const router = Router();

const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];

function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}

function isImageFile(ext: string): boolean {
  return ['.jpg', '.jpeg', '.png'].includes(ext.toLowerCase());
}

async function verifyAccess(requestId: string, userId: string, userRole: string, collection: 'multimedia' | 'digitalmedia' | 'printmaterials'): Promise<boolean> {
  try {
    if (userRole === 'ADMIN' || userRole === 'MULTIMEDIA_ADMIN') return true;

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

    if (userRole === 'CLIENT' && request.created_by?.toString() === userId) return true;

    if (request.assigned_to?.toString() === userId) return true;

    if ((request as any).shared_access?.some((id: any) => id.toString() === userId)) return true;

    return false;
  } catch {
    return false;
  }
}

router.get('/multimedia/:requestId/:filename', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId, filename } = req.params;
    const role = req.user!.role;

    if (role !== 'MULTIMEDIA' && role !== 'ADMIN' && role !== 'CLIENT' && role !== 'MULTIMEDIA_ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!isValidObjectId(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const hasAccess = await verifyAccess(requestId, req.user!.user_id, role, 'multimedia');
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

    const mimeType = getMimeType(ext);
    const fileName = Buffer.from(safeFilename, 'latin1').toString('utf8');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', isImageFile(ext) || ext === '.pdf' 
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
    const role = req.user!.role;

    if (role !== 'MULTIMEDIA' && role !== 'ADMIN' && role !== 'CLIENT' && role !== 'MULTIMEDIA_ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!isValidObjectId(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const hasAccess = await verifyAccess(requestId, req.user!.user_id, role, 'digitalmedia');
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

    const mimeType = getMimeType(ext);
    const fileName = Buffer.from(safeFilename, 'latin1').toString('utf8');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', isImageFile(ext) || ext === '.pdf' 
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
    const role = req.user!.role;

    if (role !== 'MULTIMEDIA' && role !== 'ADMIN' && role !== 'CLIENT' && role !== 'MULTIMEDIA_ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!isValidObjectId(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const hasAccess = await verifyAccess(requestId, req.user!.user_id, role, 'printmaterials');
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

    const mimeType = getMimeType(ext);
    const fileName = Buffer.from(safeFilename, 'latin1').toString('utf8');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', isImageFile(ext) || ext === '.pdf' 
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
