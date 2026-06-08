import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';
import {
  getRequestsCollection, getMultimediaRequestsCollection, getDigitalMediaRequestsCollection,
  getPrintMaterialsRequestsCollection, getUsersCollection, getCache, setCache
} from '../config/database';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';

const router = Router();

interface CollectionConfig {
  name: string;
  typeLabel: string;
  descriptionField: string;
  filterAssigned: boolean;
}

function getConfigs(role: string): CollectionConfig[] {
  if (role === 'ADMIN') {
    return [
      { name: 'IT', typeLabel: 'IT Request', descriptionField: 'issue', filterAssigned: false },
      { name: 'MM', typeLabel: 'Multimedia', descriptionField: 'event_title', filterAssigned: false },
      { name: 'DM', typeLabel: 'Digital Media', descriptionField: 'digital_media_description', filterAssigned: false },
      { name: 'PM', typeLabel: 'Print Materials', descriptionField: 'printed_media_description', filterAssigned: false },
    ];
  }
  if (role === 'TECHNICIAN') {
    return [
      { name: 'IT', typeLabel: 'IT Request', descriptionField: 'issue', filterAssigned: true },
    ];
  }
  if (role === 'MULTIMEDIA') {
    return [
      { name: 'MM', typeLabel: 'Multimedia', descriptionField: 'event_title', filterAssigned: true },
      { name: 'DM', typeLabel: 'Digital Media', descriptionField: 'digital_media_description', filterAssigned: true },
      { name: 'PM', typeLabel: 'Print Materials', descriptionField: 'printed_media_description', filterAssigned: true },
    ];
  }
  return [];
}

function getCollection(name: string) {
  switch (name) {
    case 'IT': return getRequestsCollection();
    case 'MM': return getMultimediaRequestsCollection();
    case 'DM': return getDigitalMediaRequestsCollection();
    case 'PM': return getPrintMaterialsRequestsCollection();
    default: throw new Error(`Unknown collection: ${name}`);
  }
}

function getSearchFilter(config: CollectionConfig, search: string): Record<string, unknown> {
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = { $regex: escaped, $options: 'i' };
  const searchFields: Record<string, unknown>[] = [
    { request_code: regex },
    { [config.descriptionField]: regex },
    { remarks: regex },
    { recommendation: regex },
  ];
  return { $or: searchFields };
}

async function queryCollection(
  config: CollectionConfig,
  userId: string,
  dateFilter: Record<string, unknown>,
  showDone: boolean,
  search: string | undefined,
): Promise<unknown[]> {
  const collection = getCollection(config.name);
  const filter: Record<string, unknown> = { created_at: dateFilter };

  if (config.filterAssigned) {
    filter.assigned_to = new ObjectId(userId);
  }

  if (!showDone) {
    filter.status = { $ne: 'DONE' };
  }

  if (search) {
    Object.assign(filter, getSearchFilter(config, search));
  }

  return collection.find(filter).sort({ created_at: -1 }).toArray();
}

async function fetchReports(role: string, userId: string, filterType: string, selectedDate: string, showDone: boolean, search?: string): Promise<{ reports: unknown[]; total: number }> {
  let startDate: Date, endDate: Date;

  if (filterType === 'all') {
    startDate = new Date(0);
    endDate = new Date('2099-12-31T23:59:59');
  } else if (filterType === 'daily') {
    startDate = new Date(selectedDate + 'T00:00:00');
    endDate = new Date(selectedDate + 'T23:59:59');
  } else if (filterType === 'weekly') {
    const date = new Date(selectedDate);
    const day = date.getDay();
    startDate = new Date(date);
    startDate.setDate(date.getDate() - day);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
  } else {
    const date = new Date(selectedDate);
    startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  const configs = getConfigs(role);
  const dateFilter = { $gte: startDate, $lte: endDate };

  const usersCollection = getUsersCollection();
  const allUsers = await usersCollection.find({}).project({ password: 0 }).toArray();
  const userMap = new Map<string, { first_name: string; last_name: string }>();
  allUsers.forEach(u => {
    userMap.set(u._id!.toString(), { first_name: u.first_name, last_name: u.last_name });
  });

  const allResults: unknown[] = [];

  for (const config of configs) {
    const docs = await queryCollection(config, userId, dateFilter, showDone, search);
    for (const doc of docs as Array<Record<string, unknown>>) {
      const creator = doc.created_by ? userMap.get(doc.created_by.toString()) : null;
      const technician = doc.assigned_to ? userMap.get(doc.assigned_to.toString()) : null;
      const rawCreated = doc.created_at ? new Date(doc.created_at as string).getTime() : 0;
      allResults.push({
        request_code: doc.request_code,
        type: config.typeLabel,
        description: doc[config.descriptionField] || '-',
        client_name: creator ? `${creator.first_name} ${creator.last_name}` : 'Unknown',
        technician_name: technician ? `${technician.first_name} ${technician.last_name}` : '-',
        status: doc.status || '-',
        remarks: doc.remarks || '-',
        recommendation: doc.recommendation || '-',
        completed_at: doc.completed_at
          ? new Date(doc.completed_at as string).toISOString().replace('T', ' ').substring(0, 16)
          : '-',
        _ts: rawCreated,
      });
    }
  }

  allResults.sort((a, b) => {
    const aDoc = a as Record<string, unknown>;
    const bDoc = b as Record<string, unknown>;
    return (bDoc._ts as number) - (aDoc._ts as number);
  });

  for (const r of allResults) {
    delete (r as Record<string, unknown>)._ts;
  }

  return { reports: allResults, total: allResults.length };
}

router.get('/get_reports', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;

    if (role === 'CLIENT') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const filterType = (req.query.filter as string) || 'daily';
    const selectedDate = (req.query.date as string) || new Date().toLocaleDateString('en-CA');
    const showDone = req.query.show_done !== '0';
    const search = req.query.search as string | undefined;

    const cacheKey = `reports:${role}:${userId}:${filterType}:${selectedDate}:${showDone}:${search || ''}`;
    const cached = await getCache<{ reports: unknown[]; total: number }>(cacheKey);
    if (cached) {
      res.json({ reports: cached.reports, total: cached.total });
      return;
    }

    const { reports, total } = await fetchReports(role, userId, filterType, selectedDate, showDone, search);
    await setCache(cacheKey, { reports, total }, 60);
    res.json({ reports, total });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

router.get('/export_excel', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;

    if (role === 'CLIENT') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const filterType = (req.query.filter as string) || 'daily';
    const selectedDate = (req.query.date as string) || new Date().toLocaleDateString('en-CA');
    const showDone = req.query.show_done !== '0';
    const search = req.query.search as string | undefined;

    const { reports } = await fetchReports(role, userId, filterType, selectedDate, showDone, search);

    const excelRows = (reports as Array<Record<string, unknown>>).map(r => ({
      'Request Code': r.request_code,
      'Type': r.type,
      'Description': r.description,
      'Client': r.client_name,
      'Technician': r.technician_name,
      'Status': r.status,
      'Remarks': r.remarks,
      'Recommendation': r.recommendation,
      'Completed': r.completed_at,
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reports');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=reports_${filterType}_${selectedDate}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
});

export default router;
