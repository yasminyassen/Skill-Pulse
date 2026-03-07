import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL, // ← from .env, never hardcoded
  headers: { "Content-Type": "application/json" },
  withCredentials: true, // ← sends HttpOnly cookies automatically on every request
});

// ── Automatically attach access token from localStorage to every request ──────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Auto-refresh if 401 received ──────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const res = await api.post("/auth/refresh");
        const newToken = res.data.access_token;
        localStorage.setItem("token", newToken);
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original); // retry original request
      } catch {
        // refresh failed → logout
        localStorage.removeItem("token");
        window.location.href = "/";
      }
    }
    return Promise.reject(error);
  }
);

// ── Login ─────────────────────────────────────────────────────────────────────
export const login = async (credentials: {
  username: string;
  password: string;
}) => {
  const response = await api.post("/auth/login", credentials);
  return response.data;
};

// ── Whoami ────────────────────────────────────────────────────────────────────
export const whoami = async () => {
  const response = await api.get("/auth/whoami");
  return response.data; // { id, username, role }
};

// ── Logout ────────────────────────────────────────────────────────────────────
export const logout = async () => {
  try {
    await api.post("/auth/logout");
  } catch (_) {
    // clear anyway
  } finally {
    localStorage.removeItem("token");
    window.location.href = "/";
  }
};

// ── Refresh ───────────────────────────────────────────────────────────────────
export const refreshToken = async () => {
  const response = await api.post("/auth/refresh");
  if (response.data.access_token) {
    localStorage.setItem("token", response.data.access_token);
  }
  return response.data;
};

// ── Register ──────────────────────────────────────────────────────────────────
export const register = async (data: {
  username: string;
  full_name: string;
  work_email: string;
  role: string;
  password: string;
}) => {
  const response = await api.post("/auth/register", data);
  return response.data;
};

export default api;