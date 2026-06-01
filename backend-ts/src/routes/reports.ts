import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';
import { getRequestsCollection, getUsersCollection, getCache, setCache } from '../config/database';
import { AuthenticatedRequest, isAuthenticated, isTechnicianOrAdmin } from '../middleware/auth';

const router = Router();

router.get('/get_reports', isAuthenticated, isTechnicianOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const filterType = (req.query.filter as string) || 'daily';
    const selectedDate = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const showDone = req.query.show_done !== '0';
    const search = req.query.search as string | undefined;

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

    const requestsCollection = getRequestsCollection();
    const usersCollection = getUsersCollection();

    const filter: Record<string, unknown> = {
      created_at: { $gte: startDate, $lte: endDate }
    };

    if (role === 'TECHNICIAN') {
      filter.assigned_to = new ObjectId(userId);
    }

    if (!showDone) {
      filter.status = { $ne: 'DONE' };
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      filter.$or = [
        { request_code: regex },
        { issue: regex },
        { office: regex },
        { unit: regex },
        { remarks: regex },
        { recommendation: regex }
      ];
    }

    const cacheKey = `reports:${role}:${userId}:${filterType}:${selectedDate}:${showDone}`;
    const cached = await getCache<{ reports: unknown[]; total: number }>(cacheKey);
    
    if (cached) {
      return res.json({ reports: cached.reports, total: cached.total });
    }

    const total = await requestsCollection.countDocuments(filter);

    const requests = await requestsCollection
      .find(filter)
      .sort({ created_at: -1 })
      .toArray();

    const userMap = new Map<string, { first_name: string; last_name: string }>();
    const allUsers = await usersCollection.find({}).project({ password: 0 }).toArray();
    allUsers.forEach(u => {
      userMap.set(u._id!.toString(), { first_name: u.first_name, last_name: u.last_name });
    });

    const reports = requests.map(r => {
      const creator = userMap.get(r.created_by?.toString());
      const technician = r.assigned_to ? userMap.get(r.assigned_to.toString()) : null;

      return {
        request_code: r.request_code,
        office: r.office,
        issue: r.issue,
        client_name: creator ? `${creator.first_name} ${creator.last_name}` : 'Unknown',
        technician_name: technician ? `${technician.first_name} ${technician.last_name}` : '-',
        finished: r.finished || '-',
        remarks: r.remarks || '-',
        recommendation: r.recommendation || '-',
        completed_at: r.completed_at ? r.completed_at.toISOString().replace('T', ' ').substring(0, 16) : '-'
      };
    });

    await setCache(cacheKey, { reports, total }, 60);
    res.json({ reports, total });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

router.get('/export_excel', isAuthenticated, isTechnicianOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const filterType = (req.query.filter as string) || 'daily';
    const selectedDate = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const showDone = req.query.show_done !== '0';

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

    const requestsCollection = getRequestsCollection();
    const usersCollection = getUsersCollection();

    const filter: Record<string, unknown> = {
      created_at: { $gte: startDate, $lte: endDate }
    };

    if (role === 'TECHNICIAN') {
      filter.assigned_to = new ObjectId(userId);
    }

    if (!showDone) {
      filter.status = { $ne: 'DONE' };
    }

    const requests = await requestsCollection
      .find(filter)
      .sort({ created_at: -1 })
      .toArray();

    const userMap = new Map<string, { first_name: string; last_name: string }>();
    const allUsers = await usersCollection.find({}).project({ password: 0 }).toArray();
    allUsers.forEach(u => {
      userMap.set(u._id!.toString(), { first_name: u.first_name, last_name: u.last_name });
    });

    const reports = requests.map(r => {
      const creator = userMap.get(r.created_by?.toString());
      const technician = r.assigned_to ? userMap.get(r.assigned_to.toString()) : null;

      return {
        'Request Code': r.request_code,
        'Office': r.office,
        'Issue': r.issue,
        'Client': creator ? `${creator.first_name} ${creator.last_name}` : 'Unknown',
        'Technician': technician ? `${technician.first_name} ${technician.last_name}` : '-',
        'Status': r.status || '-',
        'Remarks': r.remarks || '-',
        'Recommendation': r.recommendation || '-',
        'Completed': r.completed_at ? r.completed_at.toISOString().replace('T', ' ').substring(0, 16) : '-'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(reports);
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
