import type { CourseLite, Overview, StudentView, TeacherInfo, VerifyResult } from './types';

let authToken = localStorage.getItem('attendease_token') || '';
let facultyPin = localStorage.getItem('attendease_pin') || '';

export const setAuthToken = (t: string) => {
  authToken = t;
  if (t) localStorage.setItem('attendease_token', t);
  else localStorage.removeItem('attendease_token');
};

export const setPin = (p: string) => {
  facultyPin = p;
  if (p) localStorage.setItem('attendease_pin', p);
  else localStorage.removeItem('attendease_pin');
};

export const clearAuth = () => {
  setAuthToken('');
  setPin('');
};

export const getAuthToken = () => authToken;
export const getFacultyPin = () => facultyPin;

export const fileUrl = (file: string) => {
  const authVal = encodeURIComponent(authToken || facultyPin);
  return `/api/files/${encodeURIComponent(file)}?token=${authVal}&pin=${authVal}`;
};

async function req<T>(url: string, opt: RequestInit = {}, withAuth = true): Promise<T> {
  const headers: Record<string, string> = { ...((opt.headers as Record<string, string>) || {}) };
  const auth = authToken || facultyPin;
  if (withAuth && auth) {
    headers['x-auth-token'] = auth;
    headers['x-faculty-pin'] = auth;
    headers['Authorization'] = `Bearer ${auth}`;
  }
  if (opt.body && !(opt.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api' + url, { ...opt, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j as T;
}

const post = <T,>(url: string, body: unknown, method = 'POST') => req<T>(url, { method, body: JSON.stringify(body) });

export const api = {
  courses: (withAuth = true) => req<CourseLite[]>('/courses', {}, withAuth),
  student: (course: string, en: string) => req<StudentView>(`/student?course=${encodeURIComponent(course)}&en=${encodeURIComponent(en)}`, {}, false),
  mark: (course: string, en: string, code: string) => post('/attendance', { course, en, code }),
  submit: (id: string, en: string, file: File) => {
    const f = new FormData();
    f.append('en', en);
    f.append('file', file);
    return req(`/assignments/${id}/submit`, { method: 'POST', body: f });
  },
  login: (data: { email: string; password: string }) =>
    post<{ ok: boolean; token: string; role: 'teacher'; teacher: TeacherInfo }>('/auth/login', data),
  register: (data: { email: string; password: string; name?: string; inviteCode: string }) =>
    post<{ ok: boolean; token: string; role: 'teacher'; teacher: TeacherInfo }>('/auth/register', data),
  verify: () => req<VerifyResult>('/verify'),
  addCourse: (name: string) => post<{ id: string }>('/courses', { name }),
  saveRoster: (id: string, text: string) => post<{ count: number }>(`/courses/${id}/roster`, { text }, 'PUT'),
  startSession: (id: string, min: number) => post(`/courses/${id}/sessions`, { min }),
  closeSession: (id: string) => post(`/sessions/${id}/close`, {}),
  addAssignment: (id: string, title: string, due: number) => post(`/courses/${id}/assignments`, { title, due }),
  overview: (id: string) => req<Overview>(`/courses/${id}/overview`)
};
