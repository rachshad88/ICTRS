import { lazy, type ComponentType } from 'react';

// Every page except the landing page is its own file, downloaded the first time it is needed.
// The landing page stays in the main bundle because it renders behind the boot loader.
//
// Pages are also fetched ahead of time so a visitor rarely waits on one: a curtain transition
// starts its destination while the cover closes (PageCurtain.tsx), a signed-in user's pages
// download right after login, and a visitor's public pages when the browser is idle (App.tsx).

type PageModule = { default: ComponentType };

interface PageEntry {
  load: () => Promise<PageModule>;
  Page: ComponentType;
}

function page(importer: () => Promise<PageModule>): PageEntry {
  let loaded: PageModule | undefined;
  const load = () => importer().then((m) => (loaded = m));
  // React 18 suspends on a lazy page's first render even when its file is already here, and then
  // holds the fallback for up to 0.5s. Once loaded, hand the module over synchronously instead.
  const Page = lazy(() =>
    loaded ? ({ then: (resolve: (m: PageModule) => void) => resolve(loaded!) } as Promise<PageModule>) : load(),
  );
  return { load, Page };
}

export const PUBLIC_PAGES: Record<string, PageEntry> = {
  '/login': page(() => import('./pages/Login')),
  '/signup': page(() => import('./pages/Signup')),
  '/guide': page(() => import('./pages/ClientGuide')),
  // Wall display: no login, the backend limits it to the office network.
  '/live': page(() => import('./pages/LiveQueue')),
};

const STAFF = ['TECHNICIAN', 'ADMIN', 'MULTIMEDIA', 'IT_ADMIN', 'MULTIMEDIA_ADMIN'];
const ADMINS = ['ADMIN', 'IT_ADMIN', 'MULTIMEDIA_ADMIN'];

// Signed-in pages and the roles that may open them (none listed: any signed-in user).
export const PRIVATE_PAGES: Array<{ path: string; roles?: string[] } & PageEntry> = [
  { path: '/dashboard', roles: ['TECHNICIAN'], ...page(() => import('./pages/Dashboard')) },
  { path: '/it-dashboard', roles: ['IT_ADMIN'], ...page(() => import('./pages/ItAdminDashboard')) },
  { path: '/request', roles: ['CLIENT'], ...page(() => import('./pages/Request')) },
  { path: '/requested', ...page(() => import('./pages/Requested')) },
  { path: '/reports', roles: STAFF, ...page(() => import('./pages/Reports')) },
  { path: '/users', roles: ['ADMIN'], ...page(() => import('./pages/UserManagement')) },
  { path: '/admin-dashboard', roles: ['ADMIN'], ...page(() => import('./pages/AdminDashboard')) },
  { path: '/profile', ...page(() => import('./pages/Profile')) },
  { path: '/multimedia-request', roles: ['CLIENT'], ...page(() => import('./pages/MultimediaRequest')) },
  { path: '/multimedia-history', roles: ['CLIENT'], ...page(() => import('./pages/MultimediaHistory')) },
  { path: '/multimedia-dashboard', roles: ['MULTIMEDIA'], ...page(() => import('./pages/MultimediaRequestsDashboard')) },
  { path: '/digitalmedia-dashboard', roles: ['MULTIMEDIA'], ...page(() => import('./pages/DigitalMediaRequestsDashboard')) },
  { path: '/multimedia-management', roles: ['MULTIMEDIA_ADMIN'], ...page(() => import('./pages/MultimediaManagement')) },
  { path: '/digital-media-request', roles: ['CLIENT'], ...page(() => import('./pages/DigitalMediaRequest')) },
  { path: '/digitalmedia-history', roles: ['CLIENT'], ...page(() => import('./pages/DigitalMediaHistory')) },
  { path: '/digitalmedia-management', roles: ['MULTIMEDIA_ADMIN'], ...page(() => import('./pages/DigitalMediaManagement')) },
  { path: '/print-materials-request', roles: ['CLIENT'], ...page(() => import('./pages/PrintMaterialsRequest')) },
  { path: '/print-materials-history', roles: ['CLIENT'], ...page(() => import('./pages/PrintMaterialsHistory')) },
  { path: '/print-materials-management', roles: ['MULTIMEDIA_ADMIN'], ...page(() => import('./pages/PrintMaterialsManagement')) },
  { path: '/all-requests', roles: ADMINS, ...page(() => import('./pages/AllRequests')) },
  { path: '/audit-logs', roles: ['ADMIN'], ...page(() => import('./pages/AuditLogs')) },
  { path: '/signatories', roles: ['ADMIN'], ...page(() => import('./pages/Signatories')) },
  { path: '/print-materials-dashboard', roles: ['MULTIMEDIA'], ...page(() => import('./pages/PrintMaterialsDashboard')) },
];

/** Where an account lands by default, and where it is sent when it opens a page it may not. */
export function homeFor(primaryRole: string): string {
  if (primaryRole === 'CLIENT') return '/request';
  if (primaryRole === 'MULTIMEDIA') return '/multimedia-dashboard';
  if (primaryRole === 'IT_ADMIN') return '/it-dashboard';
  if (primaryRole === 'MULTIMEDIA_ADMIN') return '/multimedia-management';
  if (primaryRole === 'ADMIN') return '/admin-dashboard';
  return '/dashboard';
}

export function canOpen(roles: string[] | undefined, userRoles: string[]): boolean {
  return !roles || roles.some((r) => userRoles.includes(r));
}

/** Starts downloading a public page (no-op for other paths). Failures surface when it renders. */
export function preloadPage(path: string): void {
  PUBLIC_PAGES[path]?.load().catch(() => {});
}

/** Downloads the given pages one after another, so they don't compete with what is on screen. */
export async function preloadInOrder(entries: Array<{ load: () => Promise<unknown> }>): Promise<void> {
  for (const e of entries) {
    await e.load().catch(() => {});
  }
}
