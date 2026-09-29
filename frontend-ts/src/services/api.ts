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
const PUBLIC_PATHS = ['/', '/guide'];
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const expired = error.response?.status === 401 && error.response.data?.code === 'SESSION_EXPIRED';
    if (expired && !error.config?.url?.endsWith('/auth/me') && !PUBLIC_PATHS.includes(window.location.pathname)) {
      window.location.assign('/?expired=1');
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
