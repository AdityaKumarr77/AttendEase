import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { app, db } from '../src/index';

let server: http.Server;
let port: number;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        port = addr.port;
        baseUrl = `http://127.0.0.1:${port}`;
      }
      resolve();
    });
  });
});

after(() => {
  server.close();
});

test('API: Teacher registration with invite code', async () => {
  // 1. Fail with invalid invite code
  const failRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'teacher1@college.edu',
      password: 'password123',
      name: 'Professor Adams',
      inviteCode: 'wrongCode'
    })
  });
  assert.strictEqual(failRes.status, 400);
  const failData = await failRes.json();
  assert.match(failData.error, /invalid.*invite/i);

  // 2. Succeed with valid invite code (default teach123)
  const okRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'teacher1@college.edu',
      password: 'password123',
      name: 'Professor Adams',
      inviteCode: 'teach123'
    })
  });
  assert.strictEqual(okRes.status, 200);
  const okData = await okRes.json();
  assert.strictEqual(okData.ok, true);
  assert.strictEqual(okData.role, 'teacher');
  assert.ok(okData.token, 'Must return token');
  assert.strictEqual(okData.teacher.email, 'teacher1@college.edu');

  // 3. Duplicate email fails
  const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'TEACHER1@college.edu',
      password: 'password123',
      name: 'Professor Adams',
      inviteCode: 'teach123'
    })
  });
  assert.strictEqual(dupRes.status, 400);
});

test('API: Teacher login with email and password', async () => {
  // 1. Fail with wrong password
  const failRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'teacher1@college.edu',
      password: 'wrongPassword'
    })
  });
  assert.strictEqual(failRes.status, 401);

  // 2. Succeed with correct password
  const okRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'teacher1@college.edu',
      password: 'password123'
    })
  });
  assert.strictEqual(okRes.status, 200);
  const okData = await okRes.json();
  assert.strictEqual(okData.ok, true);
  assert.ok(okData.token);
});

test('API: Per-teacher course scoping and admin override', async () => {
  // Register Teacher 2
  const t2Reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'teacher2@college.edu',
      password: 'password123',
      name: 'Professor Baker',
      inviteCode: 'teach123'
    })
  });
  const t2Data = await t2Reg.json();
  const token2 = t2Data.token;

  // Login Teacher 1
  const t1Login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'teacher1@college.edu',
      password: 'password123'
    })
  });
  const t1Data = await t1Login.json();
  const token1 = t1Data.token;

  // Teacher 1 creates Course 1
  const c1Res = await fetch(`${baseUrl}/api/courses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-token': token1
    },
    body: JSON.stringify({ name: 'Physics 101' })
  });
  const c1Data = await c1Res.json();
  const c1Id = c1Data.id;

  // Teacher 2 creates Course 2
  const c2Res = await fetch(`${baseUrl}/api/courses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-token': token2
    },
    body: JSON.stringify({ name: 'Chemistry 101' })
  });
  const c2Data = await c2Res.json();
  const c2Id = c2Data.id;

  // Teacher 1 listing courses: must only see Physics 101
  const t1CoursesRes = await fetch(`${baseUrl}/api/courses`, {
    headers: { 'x-auth-token': token1 }
  });
  const t1Courses = await t1CoursesRes.json();
  assert.ok(t1Courses.some((c: any) => c.id === c1Id), 'Teacher 1 must see Physics 101');
  assert.ok(!t1Courses.some((c: any) => c.id === c2Id), 'Teacher 1 must NOT see Chemistry 101');

  // Teacher 2 listing courses: must only see Chemistry 101
  const t2CoursesRes = await fetch(`${baseUrl}/api/courses`, {
    headers: { 'x-auth-token': token2 }
  });
  const t2Courses = await t2CoursesRes.json();
  assert.ok(!t2Courses.some((c: any) => c.id === c1Id), 'Teacher 2 must NOT see Physics 101');
  assert.ok(t2Courses.some((c: any) => c.id === c2Id), 'Teacher 2 must see Chemistry 101');

  // Teacher 2 trying to access Teacher 1 course overview: must be 403 Forbidden
  const t2AccessC1 = await fetch(`${baseUrl}/api/courses/${c1Id}/overview`, {
    headers: { 'x-auth-token': token2 }
  });
  assert.strictEqual(t2AccessC1.status, 403, 'Cross-teacher access must be forbidden');

  // Admin override (using PIN): sees BOTH courses
  const adminCoursesRes = await fetch(`${baseUrl}/api/courses`, {
    headers: { 'x-faculty-pin': 'admin123' }
  });
  const adminCourses = await adminCoursesRes.json();
  assert.ok(adminCourses.some((c: any) => c.id === c1Id), 'Admin must see Physics 101');
  assert.ok(adminCourses.some((c: any) => c.id === c2Id), 'Admin must see Chemistry 101');

  // Admin override can access Physics 101 overview
  const adminAccessC1 = await fetch(`${baseUrl}/api/courses/${c1Id}/overview`, {
    headers: { 'x-faculty-pin': 'admin123' }
  });
  assert.strictEqual(adminAccessC1.status, 200, 'Admin can access any course overview');
});

test('API: CSV export with student rows, attendance count, %, assignment status, and formula injection mitigation', async () => {
  // Use admin or Teacher 1 to set up course with roster and assignments
  const token = 'admin123';

  // 1. Add course
  const cRes = await fetch(`${baseUrl}/api/courses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-faculty-pin': token },
    body: JSON.stringify({ name: 'Data Security' })
  });
  const { id: courseId } = await cRes.json();

  // 2. Set roster with regular student and formula-injection student
  const rosterText = `SEC01, Alice Smith\nSEC02, =cmd|'/C calc'!A0\nSEC03, +MaliciousPlus`;
  await fetch(`${baseUrl}/api/courses/${courseId}/roster`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-faculty-pin': token },
    body: JSON.stringify({ text: rosterText })
  });

  // 3. Create 2 assignments: "Project Alpha" (past due) and "Lab Beta" (future due)
  const now = Date.now();
  await fetch(`${baseUrl}/api/courses/${courseId}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-faculty-pin': token },
    body: JSON.stringify({ title: 'Project Alpha', due: now - 3600000 }) // due 1h ago
  });
  await fetch(`${baseUrl}/api/courses/${courseId}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-faculty-pin': token },
    body: JSON.stringify({ title: 'Lab Beta', due: now + 3600000 }) // due in 1h
  });

  // Find assignments in db
  const cAsgs = db.assignments.filter(a => a.course === courseId);
  const alphaAsg = cAsgs.find(a => a.title === 'Project Alpha')!;
  const betaAsg = cAsgs.find(a => a.title === 'Lab Beta')!;

  // Alice submitted Alpha late (after deadline)
  alphaAsg.subs.push({
    en: 'SEC01',
    file: 'f1.txt',
    orig: 'f1.txt',
    t: now // submitted now, which is past alpha.due
  });

  // Alice submitted Beta on time
  betaAsg.subs.push({
    en: 'SEC01',
    file: 'f2.txt',
    orig: 'f2.txt',
    t: now - 1000 // submitted before beta.due
  });

  // SEC02 (formula injection student) submitted Alpha on time (before due)
  alphaAsg.subs.push({
    en: 'SEC02',
    file: 'f3.txt',
    orig: 'f3.txt',
    t: now - 7200000 // 2h ago, before alpha.due
  });
  // SEC02 did not submit Beta -> Missing

  // SEC03 submitted neither -> Missing for both

  // 4. Create an attendance session and mark SEC01 and SEC02 present
  db.sessions.push({
    id: 'sess1',
    course: courseId,
    code: '1234',
    start: now - 1800000,
    min: 30,
    open: false,
    present: [
      { en: 'SEC01', t: now - 1700000 },
      { en: 'SEC02', t: now - 1700000 }
    ]
  });

  // 5. Fetch CSV via GET /api/courses/:id/csv
  const csvRes = await fetch(`${baseUrl}/api/courses/${courseId}/csv`, {
    headers: { 'x-faculty-pin': token }
  });
  assert.strictEqual(csvRes.status, 200);
  const csv = await csvRes.text();

  // Validate CSV structure:
  // Header: Enrolment,Name,Attendance Count,Attendance %,Project Alpha,Lab Beta
  const lines = csv.trim().split('\r\n');
  assert.strictEqual(lines[0], '"Enrolment","Name","Attendance Count","Attendance %","Project Alpha","Lab Beta"');

  // Row 1: Alice Smith -> Attendance count 1, Attendance % 100%, Alpha Late, Beta Submitted
  assert.ok(lines.some(l => l.includes('"Alice Smith"') && l.includes('"1"') && l.includes('"100%"') && l.includes('"Late"') && l.includes('"Submitted"')));

  // Row 2: Formula injection student '=cmd|...' -> Must be escaped with leading single quote!
  assert.ok(lines.some(l => l.includes('"\'=cmd|\'\'/C calc\'\'!A0"') && l.includes('"Submitted"') && l.includes('"Missing"')));

  // Row 3: Formula injection student '+MaliciousPlus' -> Must be escaped with leading single quote!
  assert.ok(lines.some(l => l.includes('"\'\+MaliciousPlus"') && l.includes('"0"') && l.includes('"0%"') && l.includes('"Missing"')));
});
