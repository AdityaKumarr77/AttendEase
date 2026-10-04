import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { downloadFromDrive, getDriveConfig, uploadToDrive, deleteFromDrive } from './drive';

const PIN = process.env.FACULTY_PIN || 'admin123';
const INVITE_CODE = process.env.TEACHER_INVITE_CODE || 'teach123';
const PORT = Number(process.env.PORT) || 4000;
const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS = path.join(DATA, 'uploads');
const DB_FILE = path.join(DATA, 'db.json');
fs.mkdirSync(UPLOADS, { recursive: true });

type Student = { en: string; name: string };
type Course = { id: string; name: string; students: Student[]; teacherId?: string };
type Session = { id: string; course: string; code: string; start: number; min: number; open: boolean; present: { en: string; t: number }[] };
type Sub = { en: string; file: string; orig: string; t: number; driveId?: string };
type Assignment = { id: string; course: string; title: string; due: number; subs: Sub[] };
type Teacher = { id: string; email: string; name: string; passwordHash: string; salt: string; createdAt: number };
type TokenRecord = { token: string; teacherId: string; createdAt: number };
type DB = {
  courses: Course[];
  sessions: Session[];
  assignments: Assignment[];
  teachers?: Teacher[];
  tokens?: TokenRecord[];
};

let db: DB = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : { courses: [], sessions: [], assignments: [] };
if (!db.teachers) db.teachers = [];
if (!db.tokens) db.tokens = [];

const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const same = (a: string, b: string) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const isLive = (s: Session) => s.open && Date.now() < s.start + s.min * 60000;
const fail = (res: Response, code: number, error: string) => res.status(code).json({ error });
const findStudent = (cid: string, en: string) => db.courses.find(c => c.id === cid)?.students.find(s => same(s.en, en));

export const hashPassword = (password: string): { salt: string; hash: string } => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
};

export const verifyPassword = (password: string, salt: string, expectedHash: string): boolean => {
  try {
    const hash = scryptSync(password, salt, 64).toString('hex');
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
};

export const escapeCsvCell = (val: unknown): string => {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  // Neutralize spreadsheet formula injection (=, +, -, @, \t, \r)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
};

// block brute-forcing the 4-digit code: 8 wrong tries per minute per student
const tries = new Map<string, { n: number; t: number }>();
const tooMany = (k: string, add = false) => {
  const e = tries.get(k);
  if (!e || Date.now() - e.t > 60000) { if (add) tries.set(k, { n: 1, t: Date.now() }); return false; }
  if (add) e.n++;
  return e.n >= 8;
};

const app = express();
app.use(cors());
app.use(express.json());

export type AuthUser =
  | { role: 'admin' }
  | { role: 'teacher'; teacherId: string; email: string; name: string };

export interface AuthRequest extends Request {
  authUser?: AuthUser;
}

export const getAuth = (req: Request): AuthUser | null => {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const candidate = (
    req.header('x-auth-token') ||
    req.header('x-faculty-pin') ||
    bearer ||
    req.query.token ||
    req.query.pin
  ) as string | undefined;

  if (!candidate) return null;
  if (candidate === PIN) return { role: 'admin' };

  const tok = db.tokens?.find(t => t.token === candidate);
  if (tok) {
    const teacher = db.teachers?.find(t => t.id === tok.teacherId);
    if (teacher) {
      return { role: 'teacher', teacherId: teacher.id, email: teacher.email, name: teacher.name };
    }
  }
  return null;
};

export const fac = (req: AuthRequest, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  if (!auth) return fail(res, 401, 'Unauthorized');
  req.authUser = auth;
  next();
};

const getCourseIfPermitted = (req: AuthRequest, courseId: string) => {
  const c = db.courses.find(x => x.id === courseId);
  if (!c) return { error: 'Course not found', status: 404 };
  // If teacher, they can only see/modify courses they own (teacherId matches)
  if (req.authUser?.role === 'teacher' && c.teacherId !== req.authUser.teacherId) {
    return { error: 'You do not have access to this course', status: 403 };
  }
  return { course: c };
};

const upload = multer({
  limits: { fileSize: 8 * 1024 * 1024 },
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (_r, f, cb) => cb(null, randomUUID() + path.extname(f.originalname).slice(0, 10))
  })
});

/* ---------- auth endpoints ---------- */
app.post('/api/auth/register', (req, res) => {
  const { email, password, name, inviteCode } = req.body || {};
  if (!inviteCode || String(inviteCode).trim() !== INVITE_CODE.trim()) {
    return fail(res, 400, 'Invalid teacher invite code');
  }
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return fail(res, 400, 'A valid email address is required');
  }
  if (!password || String(password).length < 6) {
    return fail(res, 400, 'Password must be at least 6 characters');
  }
  if (db.teachers?.some(t => same(t.email, cleanEmail))) {
    return fail(res, 400, 'A teacher account with this email already exists');
  }

  const { salt, hash } = hashPassword(String(password));
  const teacher: Teacher = {
    id: randomUUID().slice(0, 8),
    email: cleanEmail,
    name: String(name || '').trim() || cleanEmail.split('@')[0],
    passwordHash: hash,
    salt,
    createdAt: Date.now()
  };
  if (!db.teachers) db.teachers = [];
  if (!db.tokens) db.tokens = [];
  db.teachers.push(teacher);

  const token = randomUUID();
  db.tokens.push({ token, teacherId: teacher.id, createdAt: Date.now() });
  save();

  res.json({
    ok: true,
    token,
    role: 'teacher',
    teacher: { id: teacher.id, email: teacher.email, name: teacher.name }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const teacher = db.teachers?.find(t => same(t.email, cleanEmail));
  if (!teacher || !verifyPassword(String(password || ''), teacher.salt, teacher.passwordHash)) {
    return fail(res, 401, 'Invalid email or password');
  }

  if (!db.tokens) db.tokens = [];
  const token = randomUUID();
  db.tokens.push({ token, teacherId: teacher.id, createdAt: Date.now() });
  save();

  res.json({
    ok: true,
    token,
    role: 'teacher',
    teacher: { id: teacher.id, email: teacher.email, name: teacher.name }
  });
});

app.get('/api/verify', fac, (req: AuthRequest, res) => {
  if (req.authUser?.role === 'admin') {
    return res.json({ ok: true, role: 'admin' });
  }
  const teacherId = req.authUser?.role === 'teacher' ? req.authUser.teacherId : '';
  const teacher = db.teachers?.find(t => t.id === teacherId);
  res.json({
    ok: true,
    role: 'teacher',
    teacher: teacher ? { id: teacher.id, email: teacher.email, name: teacher.name } : undefined
  });
});

/* ---------- public / student ---------- */
app.get('/api/courses', (req: AuthRequest, res) => {
  const auth = getAuth(req);
  if (auth?.role === 'teacher') {
    return res.json(db.courses.filter(c => c.teacherId === auth.teacherId).map(c => ({ id: c.id, name: c.name })));
  }
  // Admin or public student: see all courses
  res.json(db.courses.map(c => ({ id: c.id, name: c.name })));
});

app.get('/api/student', (req, res) => {
  const course = String(req.query.course), en = String(req.query.en || '');
  const me = findStudent(course, en);
  if (!me) return res.json({ me: null });
  const ss = db.sessions.filter(s => s.course === course);
  const live = ss.find(isLive);
  res.json({
    now: Date.now(), me, total: ss.length,
    attended: ss.filter(s => s.present.some(p => same(p.en, me.en))).length,
    open: live ? { start: live.start, endsAt: live.start + live.min * 60000, marked: live.present.some(p => same(p.en, me.en)) } : null,
    asgs: db.assignments.filter(a => a.course === course).map(a => {
      const x = a.subs.find(y => same(y.en, me.en));
      return { id: a.id, title: a.title, due: a.due, sub: x ? { t: x.t, name: x.orig } : null };
    })
  });
});

app.post('/api/attendance', (req, res) => {
  const { course, en, code } = req.body as { course: string; en: string; code: string };
  const me = findStudent(course, en || '');
  if (!me) return fail(res, 404, 'You are not on this course roster');
  const key = course + ':' + me.en.toLowerCase();
  if (tooMany(key)) return fail(res, 429, 'Too many wrong attempts. Wait a minute');
  const s = db.sessions.find(x => x.course === course && isLive(x));
  if (!s) return fail(res, 400, 'No attendance window is open right now');
  if (String(code).trim() !== s.code) { tooMany(key, true); return fail(res, 400, 'Wrong code. Check the one shown in class'); }
  if (!s.present.some(p => same(p.en, me.en))) { s.present.push({ en: me.en, t: Date.now() }); save(); }
  res.json({ ok: true });
});

app.post('/api/assignments/:id/submit', upload.single('file'), async (req, res) => {
  const a = db.assignments.find(x => x.id === req.params.id);
  const drop = () => req.file && fs.unlink(req.file.path, () => {});
  if (!a) { drop(); return fail(res, 404, 'Assignment not found'); }
  const me = findStudent(a.course, String(req.body.en || ''));
  if (!me) { drop(); return fail(res, 404, 'You are not on this course roster'); }
  if (!req.file) return fail(res, 400, 'Choose a file first');

  const old = a.subs.find(x => same(x.en, me.en));
  if (old) {
    if (old.driveId) {
      deleteFromDrive(old.driveId).catch(() => {});
    }
    if (old.file) {
      const oldPath = path.join(UPLOADS, old.file);
      if (fs.existsSync(oldPath)) fs.unlink(oldPath, () => {});
    }
  }
  a.subs = a.subs.filter(x => x !== old);

  const driveConfig = getDriveConfig();
  if (driveConfig.isConfigured) {
    try {
      const fileBuffer = fs.readFileSync(req.file.path);
      const driveRes = await uploadToDrive(fileBuffer, req.file.originalname, req.file.mimetype);
      drop();
      a.subs.push({
        en: me.en,
        file: driveRes.id,
        orig: req.file.originalname,
        t: Date.now(),
        driveId: driveRes.id
      });
      save();
      return res.json({ ok: true });
    } catch (err: any) {
      drop();
      return fail(res, 500, `Google Drive upload failed: ${err.message}`);
    }
  }

  // Local disk fallback
  a.subs.push({ en: me.en, file: req.file.filename, orig: req.file.originalname, t: Date.now() });
  save();
  res.json({ ok: true });
});

/* ---------- faculty endpoints ---------- */
app.post('/api/courses', fac, (req: AuthRequest, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return fail(res, 400, 'Enter a course name');
  const c: Course = {
    id: randomUUID().slice(0, 8),
    name,
    students: [],
    teacherId: req.authUser?.role === 'teacher' ? req.authUser.teacherId : undefined
  };
  db.courses.push(c);
  save();
  res.json({ id: c.id });
});

app.put('/api/courses/:id/roster', fac, (req: AuthRequest, res) => {
  const access = getCourseIfPermitted(req, req.params.id);
  if (access.error) return fail(res, access.status!, access.error);
  const c = access.course!;
  c.students = String(req.body.text || '').split('\n').map(l => {
    const i = l.search(/[,\t]/);
    return i < 0 ? null : { en: l.slice(0, i).trim(), name: l.slice(i + 1).trim() };
  }).filter((s): s is Student => !!s && !!s.en && !!s.name);
  save();
  res.json({ count: c.students.length });
});

app.post('/api/courses/:id/sessions', fac, (req: AuthRequest, res) => {
  const cid = req.params.id;
  const access = getCourseIfPermitted(req, cid);
  if (access.error) return fail(res, access.status!, access.error);
  db.sessions.filter(s => s.course === cid).forEach(s => (s.open = false));
  db.sessions.push({
    id: randomUUID().slice(0, 8), course: cid, code: String(1000 + Math.floor(Math.random() * 9000)),
    start: Date.now(), min: Math.max(1, Math.min(60, Number(req.body.min) || 10)), open: true, present: []
  });
  save();
  res.json({ ok: true });
});

app.post('/api/sessions/:id/close', fac, (req: AuthRequest, res) => {
  const s = db.sessions.find(x => x.id === req.params.id);
  if (s) {
    const access = getCourseIfPermitted(req, s.course);
    if (access.error) return fail(res, access.status!, access.error);
    s.open = false;
    save();
  }
  res.json({ ok: true });
});

app.post('/api/courses/:id/assignments', fac, (req: AuthRequest, res) => {
  const access = getCourseIfPermitted(req, req.params.id);
  if (access.error) return fail(res, access.status!, access.error);
  const title = String(req.body.title || '').trim(), due = Number(req.body.due);
  if (!title || !due) return fail(res, 400, 'Enter a title and a deadline');
  db.assignments.push({ id: randomUUID().slice(0, 8), course: req.params.id, title, due, subs: [] });
  save();
  res.json({ ok: true });
});

app.get('/api/courses/:id/overview', fac, (req: AuthRequest, res) => {
  const access = getCourseIfPermitted(req, req.params.id);
  if (access.error) return fail(res, access.status!, access.error);
  const c = access.course!;
  const ss = db.sessions.filter(s => s.course === c.id), as = db.assignments.filter(a => a.course === c.id);
  const live = ss.find(isLive);
  res.json({
    now: Date.now(), roster: c.students, total: ss.length,
    open: live ? { id: live.id, code: live.code, start: live.start, endsAt: live.start + live.min * 60000, count: live.present.length } : null,
    sessions: ss.slice().reverse().map(s => ({ start: s.start, count: s.present.length })),
    asgs: as.map(a => ({
      id: a.id, title: a.title, due: a.due,
      subs: a.subs.map(x => ({ en: x.en, name: c.students.find(s => same(s.en, x.en))?.name || x.en, t: x.t, file: x.file, orig: x.orig }))
    })),
    report: c.students.map(s => ({
      en: s.en, name: s.name,
      att: ss.filter(x => x.present.some(p => same(p.en, s.en))).length,
      sub: as.filter(a => a.subs.some(x => same(x.en, s.en))).length
    }))
  });
});

app.get('/api/courses/:id/csv', fac, (req: AuthRequest, res) => {
  const access = getCourseIfPermitted(req, req.params.id);
  if (access.error) return fail(res, access.status!, access.error);
  const c = access.course!;
  const ss = db.sessions.filter(s => s.course === c.id);
  const as = db.assignments.filter(a => a.course === c.id);

  const headers = ['Enrolment', 'Name', 'Attendance Count', 'Attendance %', ...as.map(a => a.title)];
  const rows = c.students.map(student => {
    const attCount = ss.filter(x => x.present.some(p => same(p.en, student.en))).length;
    const attPct = (ss.length ? Math.round((attCount * 100) / ss.length) : 0) + '%';
    const asgStatuses = as.map(a => {
      const sub = a.subs.find(s => same(s.en, student.en));
      if (!sub) return 'Missing';
      return sub.t > a.due ? 'Late' : 'Submitted';
    });
    return [student.en, student.name, attCount, attPct, ...asgStatuses];
  });

  const csvContent = [headers, ...rows]
    .map(row => row.map(escapeCsvCell).join(','))
    .join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${c.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_report.csv"`);
  res.send(csvContent);
});

app.get('/api/files/:file', fac, async (req: AuthRequest, res) => {
  const file = path.basename(req.params.file);
  const asg = db.assignments.find(a => a.subs.some(s => s.file === file || s.driveId === file));
  if (!asg) return fail(res, 404, 'File not found');
  const access = getCourseIfPermitted(req, asg.course);
  if (access.error) return fail(res, access.status!, access.error);

  const sub = asg.subs.find(s => s.file === file || s.driveId === file);
  if (!sub) return fail(res, 404, 'File not found');

  if (sub.driveId) {
    try {
      const { buffer, contentType } = await downloadFromDrive(sub.driveId);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sub.orig)}"`);
      return res.send(buffer);
    } catch (err: any) {
      return fail(res, 500, `Drive download failed: ${err.message}`);
    }
  }

  const localPath = path.join(UPLOADS, sub.file);
  if (!fs.existsSync(localPath)) return fail(res, 404, 'File not found on disk');
  res.download(localPath, sub.orig);
});

/* ---------- serve built client (production) ---------- */
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => fail(res, 400, err.message));

const driveStatus = getDriveConfig().isConfigured
  ? 'Google Drive ("AttendEase Submissions" folder)'
  : `Local disk (${UPLOADS})`;

app.listen(PORT, () => {
  console.log(`AttendEase API on http://localhost:${PORT}`);
  console.log(`Faculty PIN (admin override): ${PIN === 'admin123' ? 'admin123 (default)' : 'set'}`);
  console.log(`Teacher invite code: ${INVITE_CODE}`);
  console.log(`Storage backend: ${driveStatus}`);
});

export { app, db, save };
