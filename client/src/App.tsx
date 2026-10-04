import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import Student from './Student';
import Faculty from './Faculty';
import type { CourseLite } from './types';

type Toast = { id: number; msg: string; bad?: boolean };

export default function App() {
  const [view, setView] = useState<'home' | 'student' | 'faculty'>('home');
  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dark, setDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : ''; }, [dark]);
  const notify = useCallback((msg: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, bad }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);
  const go = async (v: 'student' | 'faculty') => {
    try { setCourses(await api.courses(v === 'faculty')); } catch { notify('Cannot reach the server', true); return; }
    setView(v);
  };

  return (
    <div className="wrap">
      <nav>
        <div className="logo" onClick={() => setView('home')}><i>&#10003;</i>AttendEase</div>
        <button className="ib" onClick={() => setDark(d => !d)} title="Toggle theme">&#9680;</button>
      </nav>

      {view === 'home' && (
        <>
          <div className="hero">
            <h1>Attendance and assignments,<br /><b>without the paperwork</b></h1>
            <p>One place for faculty to take attendance and collect assignments, with live counts and instant reports.</p>
          </div>
          <div className="grid">
            <button className="card role" onClick={() => go('student')}><span className="em">&#127891;</span><h2>I'm a student</h2><div className="mu">Mark attendance and submit assignments</div></button>
            <button className="card role" onClick={() => go('faculty')}><span className="em">&#128104;&#8205;&#127979;</span><h2>I'm faculty</h2><div className="mu">Run sessions, track submissions, see reports</div></button>
          </div>
        </>
      )}
      {view === 'student' && <Student courses={courses} notify={notify} onExit={() => setView('home')} />}
      {view === 'faculty' && <Faculty notify={notify} onExit={() => setView('home')} />}

      <div id="toast">{toasts.map(t => <div key={t.id} className={'t' + (t.bad ? ' bad' : '')}>{t.msg}</div>)}</div>
    </div>
  );
}
