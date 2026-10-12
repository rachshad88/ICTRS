import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

// The server ends a session when the user is deleted or an admin changes their roles or password.
// Send them to the login page (which shows a "session expired" notice) instead of leaving pages that
// silently fail. /auth/me is skipped: it is how the app checks for a session on first load.
const PUBLIC_PATHS = ['/', '/login', '/guide'];
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const code = error.response?.status === 401 ? error.response.data?.code : undefined;
    const expired = code === 'SESSION_EXPIRED' || code === 'SESSION_REPLACED';
    if (expired && !error.config?.url?.endsWith('/auth/me') && !PUBLIC_PATHS.includes(window.location.pathname)) {
      // Replaced: the account signed in on another device (one session per user).
      window.location.assign(code === 'SESSION_REPLACED' ? '/login?replaced=1' : '/login?expired=1');
    }
    // Still on the default password: the Profile page explains and holds the change-password form.
    const mustChange = error.response?.status === 403 && error.response.data?.code === 'PASSWORD_CHANGE_REQUIRED';
    if (mustChange && window.location.pathname !== '/profile') {
      window.location.assign('/profile');
    }
    return Promise.reject(error);
  }
);

export default api;
