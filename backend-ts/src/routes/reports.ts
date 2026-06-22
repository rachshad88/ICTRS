import { Router, Response } from 'express';
import { ObjectId, Collection, Document } from 'mongodb';
import * as XLSX from 'xlsx';
import {
  getRequestsCollection, getMultimediaRequestsCollection, getDigitalMediaRequestsCollection,
  getPrintMaterialsRequestsCollection, getSoftwareRequestsCollection, getUsersCollection, getCache, setCache
} from '../config/database';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';

const router = Router();

import { Role } from '../config/database';

interface TypeConfig {
  getCollection: () => Collection<Document>;
  typeLabel: string;
  roleAccess: Role[];
  filterAssigned: boolean;
}

const TYPE_MAP: Record<string, () => TypeConfig> = {
  'it': () => ({
    getCollection: () => getRequestsCollection() as unknown as Collection<Document>,
    typeLabel: 'IT Request',
    roleAccess: ['ADMIN', 'TECHNICIAN', 'IT_ADMIN'],
    filterAssigned: true,
  }),
  'multimedia': () => ({
    getCollection: () => getMultimediaRequestsCollection() as unknown as Collection<Document>,
    typeLabel: 'Multimedia',
    roleAccess: ['ADMIN', 'MULTIMEDIA', 'MULTIMEDIA_ADMIN'],
    filterAssigned: true,
  }),
  'digital-media': () => ({
    getCollection: () => getDigitalMediaRequestsCollection() as unknown as Collection<Document>,
    typeLabel: 'Digital Media',
    roleAccess: ['ADMIN', 'MULTIMEDIA', 'MULTIMEDIA_ADMIN'],
    filterAssigned: true,
  }),
  'print-materials': () => ({
    getCollection: () => getPrintMaterialsRequestsCollection() as unknown as Collection<Document>,
    typeLabel: 'Print Materials',
    roleAccess: ['ADMIN', 'MULTIMEDIA', 'MULTIMEDIA_ADMIN'],
    filterAssigned: true,
  }),
  'software': () => ({
    getCollection: () => getSoftwareRequestsCollection() as unknown as Collection<Document>,
    typeLabel: 'Software Development',
    roleAccess: ['ADMIN', 'IT_ADMIN', 'PROGRAMMER'],
    filterAssigned: true,
  }),
};

const TYPE_LIST = ['it', 'multimedia', 'digital-media', 'print-materials', 'software'];

function getDateRange(filterType: string, selectedDate: string): { startDate: Date; endDate: Date } {
  if (filterType === 'all') {
    return { startDate: new Date(0), endDate: new Date('2099-12-31T23:59:59') };
  }
  if (filterType === 'daily') {
    return {
      startDate: new Date(selectedDate + 'T00:00:00'),
      endDate: new Date(selectedDate + 'T23:59:59'),
    };
  }
  if (filterType === 'weekly') {
    const date = new Date(selectedDate);
    const day = date.getDay();
    const startDate = new Date(date);
    startDate.setDate(date.getDate() - day);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  }
  const date = new Date(selectedDate);
  const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
  const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startDate, endDate };
}

function buildFilter(
  dateFilter: Record<string, unknown>,
  showDone: boolean,
  search?: string,
  typeKey?: string,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { created_at: dateFilter };

  if (!showDone) {
    filter.status = { $ne: 'DONE' };
  }

  if (search && typeKey) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    const searchFields: Record<string, unknown>[] = [{ request_code: regex }, { remarks: regex }];
    if (typeKey === 'it') {
      searchFields.push({ issue: regex }, { office: regex }, { unit: regex }, { recommendation: regex });
    } else if (typeKey === 'multimedia') {
      searchFields.push({ event_title: regex }, { specific_location: regex }, { recommendation: regex });
    } else if (typeKey === 'digital-media') {
      searchFields.push({ digital_media_description: regex }, { event_ppa_name: regex }, { requestor_name: regex });
    } else if (typeKey === 'print-materials') {
      searchFields.push({ printed_media_description: regex }, { event_ppa_name: regex }, { requestor_name: regex });
    } else if (typeKey === 'software') {
      searchFields.push({ proposed_title: regex }, { client_name_office: regex }, { statement_of_problem: regex });
    }
    filter.$or = searchFields;
  }

  return filter;
}

function addUserInfo(doc: Record<string, unknown>, userMap: Map<string, { first_name: string; last_name: string }>) {
  const creator = doc.created_by ? userMap.get(doc.created_by.toString()) : null;
  const technician = doc.assigned_to ? userMap.get(doc.assigned_to.toString()) : null;
  return {
    ...doc,
    _id: doc._id?.toString(),
    client_name: creator ? `${creator.first_name} ${creator.last_name}` : 'Unknown',
    technician_name: technician ? `${technician.first_name} ${technician.last_name}` : '-',
  };
}

async function queryType(
  typeKey: string,
  roles: string[],
  userId: string,
  filterType: string,
  selectedDate: string,
  showDone: boolean,
  search?: string,
): Promise<{ reports: Record<string, unknown>[]; total: number }> {
  const config = TYPE_MAP[typeKey]?.();
  if (!config) return { reports: [], total: 0 };

  const { startDate, endDate } = getDateRange(filterType, selectedDate);
  const dateFilter = { $gte: startDate, $lte: endDate };
  const filter = buildFilter(dateFilter, showDone, search, typeKey);

  if (config.filterAssigned && !roles.some(r => config.roleAccess.includes(r as Role) && r.includes('ADMIN'))) {
    filter.assigned_to = new ObjectId(userId);
  }

  const usersCollection = getUsersCollection();
  const allUsers = await usersCollection.find({}).project({ password: 0 }).toArray();
  const userMap = new Map<string, { first_name: string; last_name: string }>();
  allUsers.forEach(u => {
    userMap.set(u._id!.toString(), { first_name: u.first_name, last_name: u.last_name });
  });

  const docs = await config.getCollection().find(filter).sort({ created_at: -1 }).toArray();
  const reports = docs.map(d => addUserInfo(d as unknown as Record<string, unknown>, userMap));

  return { reports, total: reports.length };
}

router.get('/get_reports', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const roles = req.user!.roles;

    if (roles.includes('CLIENT') && roles.length === 1) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const typeKey = (req.query.type as string) || 'it';
    const filterType = (req.query.filter as string) || 'daily';
    const selectedDate = (req.query.date as string) || new Date().toLocaleDateString('en-CA');
    const showDone = req.query.show_done !== '0';
    const search = req.query.search as string | undefined;

    const config = TYPE_MAP[typeKey]?.();
    if (!config || !config.roleAccess.some(r => roles.includes(r))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const cacheKey = `reports:${typeKey}:${roles.join(',')}:${userId}:${filterType}:${selectedDate}:${showDone}:${search || ''}`;
    const cached = await getCache<{ reports: Record<string, unknown>[]; total: number }>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const result = await queryType(typeKey, roles, userId, filterType, selectedDate, showDone, search);
    await setCache(cacheKey, result, 60);
    res.json(result);
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

router.get('/export_excel', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const roles = req.user!.roles;

    if (roles.includes('CLIENT') && roles.length === 1) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const typeKey = (req.query.type as string) || 'it';
    const filterType = (req.query.filter as string) || 'daily';
    const selectedDate = (req.query.date as string) || new Date().toLocaleDateString('en-CA');
    const showDone = req.query.show_done !== '0';
    const search = req.query.search as string | undefined;

    const config = TYPE_MAP[typeKey]?.();
    if (!config || !config.roleAccess.some(r => roles.includes(r))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { reports } = await queryType(typeKey, roles, userId, filterType, selectedDate, showDone, search);
    if (reports.length === 0) {
      res.status(404).json({ error: 'No reports found' });
      return;
    }

    const internalFields = new Set(['_id', 'created_by', 'assigned_to', 'created_at']);
    const headers = Object.keys(reports[0]).filter(k => !internalFields.has(k));
    const excelRows = reports.map(r => {
      const row: Record<string, unknown> = {};
      for (const h of headers) {
        let val = r[h];
        if (val instanceof Date) {
          val = val.toISOString().replace('T', ' ').substring(0, 16);
        }
        row[h] = val ?? '-';
      }
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reports');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${typeKey}_${filterType}_${selectedDate}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
});

export default router;
