import { useQuery } from '@tanstack/react-query';
import { api } from './api';

const NO_OFFICES: string[] = [];

/** The offices people can pick, from the server (the super admin manages them on the Offices page). */
export function useOffices(): string[] {
  const { data } = useQuery({
    queryKey: ['meta', 'offices'],
    queryFn: () => api.get<{ offices: string[] }>('/offices').then((r) => r.data.offices),
    staleTime: 5 * 60 * 1000,
  });
  return data ?? NO_OFFICES;
}

/** The list plus an office that is no longer offered (hidden or renamed), so a form still shows it. */
export function withCurrentOffice(offices: string[], current: string | undefined): string[] {
  return current && !offices.includes(current) ? [current, ...offices] : offices;
}
