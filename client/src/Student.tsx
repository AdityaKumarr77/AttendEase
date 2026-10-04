import { useState } from 'react';
import { api } from './api';
import { Countdown, Ring, fmt, pct, pctColor } from './ui';
import type { CourseLite, Notify, StudentView } from './types';

export default function Student({ courses, notify, onExit }: { courses: CourseLite[]; notify: Notify; onExit: () => void }) {
  const [course, setCourse] = useState(courses[0]?.id || '');
  const [en, setEn] = useState('');
  const [d, setD] = useState<StudentView | null>(null);
  const [skew, setSkew] = useState(0);
  const [code, setCode] = useState('');
  const [files, setFiles] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState(false);

  const load = async (quiet = false) => {
    try {
      const v = await api.student(course, en);
      if (!v.me) { if (!quiet) notify('Not found on this roster', true); return; }
      setD(v); setSkew(v.now - Date.now());
    } catch (e) { notify((e as Error).message, true); }
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); notify(ok); await load(true); } catch (e) { notify((e as Error).message, true); }
    setBusy(false);
  };

  if (!d || !d.me) {
    return (
      <div className="card narrow">
        <h2>Student sign in</h2>
        <div className="mu">Choose your course and enter your enrolment number.</div>
        {courses.length === 0 ? <p className="mu">No courses yet. Ask your faculty to set one up.</p> : (
          <>
            <div className="row"><select className="w" value={course} onChange={e => setCourse(e.target.value)}>{courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="row">
              <input className="w" placeholder="Enrolment number" value={en} onChange={e => setEn(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
              <button className="btn" onClick={() => load()}>Continue</button>
            </div>
          </>
        )}
        <button className="btn s" onClick={onExit}>Back</button>
      </div>
    );
  }

  const p = pct(d.attended, d.total);
  return (
    <>
      <div className="card mid">
        <Ring p={p} color={pctColor(p)} />
        <div>
          <h2>Hi {d.me.name.split(' ')[0]}</h2>
          <div className="mu">{d.attended} of {d.total} sessions attended</div>
          {d.total > 0 && p < 75 && <span className="chip bad">Below 75%</span>}
        </div>
      </div>

      <div className="card">
        <h2>Attendance</h2>
        {!d.open && <div className="mu">No attendance window is open right now.</div>}
        {d.open?.marked && <div className="ok"><b>You are marked present</b> for this session. &#10003;</div>}
        {d.open && !d.open.marked && (
          <>
            <div className="mu">Enter the 4-digit code shown in class.</div>
            <div className="row">
              <input className="w codein" inputMode="numeric" maxLength={4} placeholder="0000" value={code} onChange={e => setCode(e.target.value)} />
              <button className="btn" disabled={busy} onClick={() => act(() => api.mark(course, d.me!.en, code), 'Attendance marked')}>Mark present</button>
            </div>
            <span className="chip warn">Closes in <Countdown end={d.open.endsAt} skew={skew} onDone={() => load(true)} /></span>
          </>
        )}
      </div>

      <div className="card">
        <h2>Assignments</h2>
        {d.asgs.length === 0 && <div className="mu">Nothing assigned yet.</div>}
        {d.asgs.map(a => {
          const late = Date.now() + skew > a.due;
          return (
            <div className="item" key={a.id}>
              <div><h3>{a.title}</h3><div className="mu">Due {fmt(a.due)}</div></div>
              <div>
                {a.sub
                  ? <><span className={'chip ' + (a.sub.t > a.due ? 'warn' : 'ok')}>{a.sub.t > a.due ? 'Submitted late' : 'Submitted'}</span> <span className="mu">{a.sub.name}</span></>
                  : <span className={'chip ' + (late ? 'bad' : 'warn')}>{late ? 'Overdue' : 'Pending'}</span>}
                <div className="row">
                  <label className="file">
                    <input type="file" onChange={e => { const f = e.target.files?.[0]; if (f) setFiles(s => ({ ...s, [a.id]: f })); }} />
                    {files[a.id]?.name || 'Choose file (max 8 MB)'}
                  </label>
                  <button className="btn" disabled={busy || !files[a.id]}
                    onClick={() => act(() => api.submit(a.id, d.me!.en, files[a.id]), 'Submitted')}>{a.sub ? 'Replace' : 'Submit'}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="row"><button className="btn s" onClick={() => load(true)}>Refresh</button><button className="btn s" onClick={onExit}>Sign out</button></div>
    </>
  );
}
