import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import {
  getRequestsCollection,
  getMultimediaRequestsCollection,
  getDigitalMediaRequestsCollection,
  getPrintMaterialsRequestsCollection
} from '../config/database';

const router = Router();

// For the CSF rating system only, which has no ITRS login: it sends the shared key CSF_API_KEY (in
// backend-ts/.env) in an X-CSF-Key header, from its server rather than a browser, where anyone could
// read it. With no key set the endpoint is closed.
function csfKeyOnly(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CSF_API_KEY || '';
  const sent = req.get('X-CSF-Key') || '';
  const a = crypto.createHash('sha256').update(sent).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!expected || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'A valid X-CSF-Key header is required' });
    return;
  }
  next();
}

router.get('/request-codes', csfKeyOnly, async (_req, res: Response) => {
  try {
    const requestsCol = getRequestsCollection();
    const multimediaCol = getMultimediaRequestsCollection();
    const digitalCol = getDigitalMediaRequestsCollection();
    const printCol = getPrintMaterialsRequestsCollection();

    const [requests, multimedia, digital, print] = await Promise.all([
      requestsCol.find({}, { projection: { request_code: 1 } }).toArray(),
      multimediaCol.find({}, { projection: { request_code: 1 } }).toArray(),
      digitalCol.find({}, { projection: { request_code: 1 } }).toArray(),
      printCol.find({}, { projection: { request_code: 1 } }).toArray(),
    ]);

    res.json({
      requests: requests.map(r => r.request_code),
      multimedia: multimedia.map(r => r.request_code),
      digital_media: digital.map(r => r.request_code),
      print_materials: print.map(r => r.request_code),
    });
  } catch (error) {
    console.error('CSF request codes error:', error);
    res.status(500).json({ error: 'Failed to fetch request codes' });
  }
});

export default router;