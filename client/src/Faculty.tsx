import { useCallback, useEffect, useState } from 'react';
import { api, clearAuth, fileUrl, getAuthToken, getFacultyPin, setAuthToken, setPin } from './api';
import { Countdown, Ring, fmt, pct, useNow } from './ui';
import { downloadCourseCsv } from './csv';
import type { CourseLite, Notify, Overview, TeacherInfo } from './types';

type Tab = 'attendance' | 'assignments' | 'report' | 'roster';
type AuthMode = 'signin' | 'register' | 'pin';

const TABS: [Tab, string][] = [
  ['attendance', 'Attendance'],
  ['assignments', 'Assignments'],
  ['report', 'Report'],
  ['roster', 'Roster']
];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export default function Faculty({ notify, onExit }: { notify: Notify; onExit: () => void }) {
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState<'admin' | 'teacher' | null>(null);
  const [teacher, setTeacher] = useState<TeacherInfo | null>(null);

  // Auth form state
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [pinIn, setPinIn] = useState('');

  // Course & dashboard state
  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [course, setCourse] = useState('');
  const [d, setD] = useState<Overview | null>(null);
  const [skew, setSkew] = useState(0);
  const [tab, setTab] = useState<Tab>('attendance');
  const [newCourse, setNewCourse] = useState('');
  const [roster, setRoster] = useState('');
  const [mins, setMins] = useState(10);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const now = useNow();

  const load = useCallback(
    async (cid: string) => {
      if (!cid) {
        setD(null);
        return;
      }
      try {
        const v = await api.overview(cid);
        setD(v);
        setSkew(v.now - Date.now());
      } catch (e) {
        notify((e as Error).message, true);
      }
    },
    [notify]
  );

  const loadCourses = useCallback(
    async (select?: string) => {
      try {
        const c = await api.courses();
        setCourses(c);
        const id = select || (c.some(x => x.id === course) ? course : c[0]?.id || '');
        setCourse(id);
        await load(id);
      } catch (e) {
        notify((e as Error).message, true);
      }
    },
    [course, load, notify]
  );

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      notify(ok);
      await load(course);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

  // Restore saved session on mount
  useEffect(() => {
    const restoreSession = async () => {
      if (!getAuthToken() && !getFacultyPin()) return;
      try {
        const v = await api.verify();
        setAuthed(true);
        setRole(v.role);
        if (v.teacher) setTeacher(v.teacher);
        await loadCourses();
      } catch {
        clearAuth();
      }
    };
    restoreSession();
  }, [loadCourses]);

  useEffect(() => {
    if (d && tab === 'roster') {
      setRoster(d.roster.map(s => s.en + ', ' + s.name).join('\n'));
    }
  }, [tab, d?.roster.length]); // eslint-disable-line

  useEffect(() => {
    // live count while a session is open
    if (!(authed && tab === 'attendance' && d?.open)) return;
    const i = setInterval(() => load(course), 5000);
    return () => clearInterval(i);
  }, [authed, tab, d?.open?.id, course, load]);

  const handleTeacherLogin = async () => {
    if (!email || !password) {
      notify('Please enter both email and password', true);
      return;
    }
    try {
      clearAuth();
      const res = await api.login({ email, password });
      setAuthToken(res.token);
      setAuthed(true);
      setRole('teacher');
      setTeacher(res.teacher);
      notify(`Welcome back, ${res.teacher.name || res.teacher.email}`);
      await loadCourses();
    } catch (e) {
      clearAuth();
      notify((e as Error).message, true);
    }
  };

  const handleTeacherRegister = async () => {
    if (!email || !password || !inviteCode) {
      notify('Email, password, and invite code are required', true);
      return;
    }
    try {
      clearAuth();
      const res = await api.register({ email, password, name, inviteCode });
      setAuthToken(res.token);
      setAuthed(true);
      setRole('teacher');
      setTeacher(res.teacher);
      notify('Teacher account registered successfully');
      await loadCourses();
    } catch (e) {
      clearAuth();
      notify((e as Error).message, true);
    }
  };

  const handleAdminPinUnlock = async () => {
    if (!pinIn) {
      notify('Please enter the faculty PIN', true);
      return;
    }
    try {
      clearAuth();
      setPin(pinIn);
      const res = await api.verify();
      setAuthed(true);
      setRole(res.role || 'admin');
      notify('Admin override active — viewing all courses');
      await loadCourses();
    } catch (e) {
      clearAuth();
      notify((e as Error).message, true);
    }
  };

  const handleSignOut = () => {
    clearAuth();
    setAuthed(false);
    setRole(null);
    setTeacher(null);
    setPinIn('');
    setEmail('');
    setPassword('');
    setCourses([]);
    setD(null);
    onExit();
  };

  if (!authed) {
    return (
      <div className="card narrow">
        <h2>Faculty sign in</h2>
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button className={authMode === 'signin' ? 'on' : ''} onClick={() => setAuthMode('signin')}>
            Teacher Sign in
          </button>
          <button className={authMode === 'register' ? 'on' : ''} onClick={() => setAuthMode('register')}>
            Register
          </button>
          <button className={authMode === 'pin' ? 'on' : ''} onClick={() => setAuthMode('pin')}>
            Admin PIN
          </button>
        </div>

        {authMode === 'signin' && (
          <>
            <div className="mu" style={{ marginBottom: 12 }}>
              Sign in with your teacher credentials to view and manage your courses.
            </div>
            <div className="row">
              <input
                type="email"
                className="w"
                placeholder="Teacher email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTeacherLogin()}
              />
            </div>
            <div className="row">
              <input
                type="password"
                className="w"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTeacherLogin()}
              />
            </div>
            <div className="row">
              <button className="btn w" onClick={handleTeacherLogin}>
                Sign in
              </button>
            </div>
          </>
        )}

        {authMode === 'register' && (
          <>
            <div className="mu" style={{ marginBottom: 12 }}>
              Register using the teacher invite code set by your administrator.
            </div>
            <div className="row">
              <input
                className="w"
                placeholder="Your Name (e.g. Prof. Smith)"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="row">
              <input
                type="email"
                className="w"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="row">
              <input
                type="password"
                className="w"
                placeholder="Password (min 6 chars)"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
            <div className="row">
              <input
                className="w"
                placeholder="Teacher invite code"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTeacherRegister()}
              />
            </div>
            <div className="row">
              <button className="btn w" onClick={handleTeacherRegister}>
                Register Account
              </button>
            </div>
          </>
        )}

        {authMode === 'pin' && (
          <>
            <div className="mu" style={{ marginBottom: 12 }}>
              Admin override: Enter the server faculty PIN to view and manage all courses across all teachers.
            </div>
            <div className="row">
              <input
                type="password"
                className="w"
                placeholder="Faculty PIN"
                value={pinIn}
                onChange={e => setPinIn(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdminPinUnlock()}
              />
              <button className="btn" onClick={handleAdminPinUnlock}>
                Unlock
              </button>
            </div>
          </>
        )}

        <div style={{ marginTop: 14 }}>
          <button className="btn s" onClick={onExit}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const avg =
    d && d.report.length && d.total
      ? Math.round(d.report.reduce((s, r) => s + pct(r.att, d.total), 0) / d.report.length)
      : 0;
  const pending = d ? d.asgs.reduce((s, a) => s + Math.max(0, d.roster.length - a.subs.length), 0) : 0;
  const currentCourseName = courses.find(c => c.id === course)?.name || 'Course';

  return (
    <>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          {role === 'admin' ? (
            <>
              <b>Admin Override</b> <span className="chip warn">All courses visible</span>
            </>
          ) : (
            <>
              <b>{teacher?.name || teacher?.email}</b> <span className="chip ok">Teacher</span> <span className="mu">({teacher?.email})</span>
            </>
          )}
        </div>
        <button className="btn s" onClick={handleSignOut}>
          Sign out
        </button>
      </div>

      <div className="card">
        <div className="row nomar">
          <select
            className="w"
            value={course}
            onChange={e => {
              setCourse(e.target.value);
              load(e.target.value);
            }}
          >
            {courses.length === 0 ? (
              <option value="">No courses yet</option>
            ) : (
              courses.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            )}
          </select>
          <input
            className="w"
            placeholder="New course name"
            value={newCourse}
            onChange={e => setNewCourse(e.target.value)}
          />
          <button
            className="btn"
            onClick={async () => {
              try {
                const r = await api.addCourse(newCourse);
                setNewCourse('');
                notify('Course added');
                await loadCourses(r.id);
              } catch (e) {
                notify((e as Error).message, true);
              }
            }}
          >
            Add course
          </button>
        </div>
      </div>

      {!d && (
        <div className="card mu">
          {courses.length === 0 ? 'Add your first course to begin.' : 'Select a course to view details.'}
        </div>
      )}

      {d && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="mu">Students</span>
              <b>{d.roster.length}</b>
            </div>
            <div className="stat">
              <span className="mu">Sessions</span>
              <b>{d.total}</b>
            </div>
            <div className="stat">
              <span className="mu">Avg attendance</span>
              <b>{avg}%</b>
            </div>
            <div className="stat">
              <span className="mu">Pending work</span>
              <b>{pending}</b>
            </div>
          </div>
          <div className="tabs">
            {TABS.map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'attendance' && (
            <>
              <div className="card">
                <h2>Take attendance</h2>
                {d.open ? (
                  <>
                    <div className="mu center">Show this code in class</div>
                    <div className="code">{d.open.code}</div>
                    <div className="mid center">
                      <Ring
                        big
                        p={Math.max(
                          0,
                          Math.round(((d.open.endsAt - (now + skew)) * 100) / (d.open.endsAt - d.open.start))
                        )}
                      >
                        <Countdown end={d.open.endsAt} skew={skew} onDone={() => load(course)} />
                      </Ring>
                      <div>
                        <b className="bignum">{d.open.count}</b> / {d.roster.length}
                        <div className="mu">present, updates live</div>
                      </div>
                    </div>
                    <div className="row center">
                      <button
                        className="btn d"
                        onClick={() => act(() => api.closeSession(d.open!.id), 'Session closed')}
                      >
                        Close now
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="row">
                      <label className="mu">
                        Window (minutes){' '}
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={mins}
                          onChange={e => setMins(+e.target.value)}
                          style={{ width: 80 }}
                        />
                      </label>
                      <button
                        className="btn"
                        disabled={!d.roster.length}
                        onClick={() => act(() => api.startSession(course, mins), 'Session started')}
                      >
                        Start session
                      </button>
                    </div>
                    {!d.roster.length && <div className="mu">Add a roster first.</div>}
                  </>
                )}
              </div>
              {d.sessions.length > 0 && (
                <div className="card">
                  <h2>Past sessions</h2>
                  <div className="sc">
                    <table>
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Present</th>
                          <th>Absent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.sessions.map((s, i) => (
                          <tr key={i}>
                            <td>{fmt(s.start)}</td>
                            <td>{s.count}</td>
                            <td>{Math.max(0, d.roster.length - s.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'assignments' && (
            <>
              <div className="card">
                <h2>New assignment</h2>
                <div className="row">
                  <input
                    className="w"
                    placeholder="Title"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                  />
                  <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
                  <button
                    className="btn"
                    onClick={() =>
                      act(async () => {
                        await api.addAssignment(course, title, due ? new Date(due).getTime() : 0);
                        setTitle('');
                        setDue('');
                      }, 'Assignment created')
                    }
                  >
                    Create
                  </button>
                </div>
              </div>
              {d.asgs.map(a => {
                const miss = d.roster.filter(s => !a.subs.some(x => same(x.en, s.en)));
                return (
                  <div className="card" key={a.id}>
                    <div className="item first">
                      <div>
                        <h3>{a.title}</h3>
                        <div className="mu">Due {fmt(a.due)}</div>
                      </div>
                      <span className={'chip ' + (miss.length ? 'warn' : 'ok')}>
                        {a.subs.length}/{d.roster.length} submitted
                      </span>
                    </div>
                    {a.subs.map(x => (
                      <div className="item" key={x.en}>
                        <div>
                          {x.name} <span className="mu">{x.en}</span>
                        </div>
                        <div>
                          {x.t > a.due && <span className="chip warn">Late</span>}{' '}
                          <a href={fileUrl(x.file)} target="_blank" rel="noopener">
                            {x.orig}
                          </a>
                        </div>
                      </div>
                    ))}
                    {miss.length > 0 && (
                      <div className="mu" style={{ marginTop: 8 }}>
                        Pending: {miss.map(m => m.name).join(', ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {tab === 'report' && (
            <div className="card">
              <div className="item first" style={{ marginBottom: 12 }}>
                <h2>Report</h2>
                <button
                  className="btn"
                  disabled={!d.roster.length}
                  onClick={() => {
                    downloadCourseCsv(d, currentCourseName);
                    notify('CSV downloaded');
                  }}
                >
                  Download CSV
                </button>
              </div>
              <div className="sc">
                <table>
                  <thead>
                    <tr>
                      <th>Enrolment</th>
                      <th>Name</th>
                      <th>Attendance</th>
                      <th></th>
                      <th>Work</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.report.map(r => {
                      const p = pct(r.att, d.total);
                      return (
                        <tr key={r.en}>
                          <td>{r.en}</td>
                          <td>{r.name}</td>
                          <td>
                            {r.att}/{d.total} ({p}%)
                          </td>
                          <td>
                            <div className="bar">
                              <i style={{ width: p + '%' }} />
                            </div>
                          </td>
                          <td>
                            {r.sub}/{d.asgs.length} {d.total > 0 && p < 75 && <span className="chip bad">Low</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'roster' && (
            <div className="card">
              <h2>Roster</h2>
              <div className="mu">One student per line: enrolment number, name</div>
              <textarea
                placeholder="ICF001, Riya Sharma"
                value={roster}
                onChange={e => setRoster(e.target.value)}
              />
              <div className="row">
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      const r = await api.saveRoster(course, roster);
                      notify(r.count + ' students saved');
                      await load(course);
                    } catch (e) {
                      notify((e as Error).message, true);
                    }
                  }}
                >
                  Save roster
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
