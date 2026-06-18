import { Router, Response } from 'express';
import {
  getRequestsCollection,
  getMultimediaRequestsCollection,
  getDigitalMediaRequestsCollection,
  getPrintMaterialsRequestsCollection,
  getSoftwareRequestsCollection
} from '../config/database';

const router = Router();

router.get('/request-codes', async (_req, res: Response) => {
  try {
    const requestsCol = getRequestsCollection();
    const multimediaCol = getMultimediaRequestsCollection();
    const digitalCol = getDigitalMediaRequestsCollection();
    const printCol = getPrintMaterialsRequestsCollection();
    const softwareCol = getSoftwareRequestsCollection();

    const [requests, multimedia, digital, print, software] = await Promise.all([
      requestsCol.find({}, { projection: { request_code: 1 } }).toArray(),
      multimediaCol.find({}, { projection: { request_code: 1 } }).toArray(),
      digitalCol.find({}, { projection: { request_code: 1 } }).toArray(),
      printCol.find({}, { projection: { request_code: 1 } }).toArray(),
      softwareCol.find({}, { projection: { request_code: 1 } }).toArray(),
    ]);

    res.json({
      requests: requests.map(r => r.request_code),
      multimedia: multimedia.map(r => r.request_code),
      digital_media: digital.map(r => r.request_code),
      print_materials: print.map(r => r.request_code),
      software: software.map(r => r.request_code),
    });
  } catch (error) {
    console.error('CSF request codes error:', error);
    res.status(500).json({ error: 'Failed to fetch request codes' });
  }
});

export default router;