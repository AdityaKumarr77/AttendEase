import { useEffect, useState } from 'react';

export const fmt = (t: number) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const pct = (a: number, t: number) => (t ? Math.round((a * 100) / t) : 0);
export const pctColor = (p: number) => (p >= 75 ? 'var(--ok)' : 'var(--bad)');

export function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  return now;
}

export const clock = (ms: number) => {
  const l = Math.max(0, ms);
  return Math.floor(l / 60000) + ':' + String(Math.floor(l / 1000) % 60).padStart(2, '0');
};

export function Ring({ p, color = 'var(--pr)', big = false, children }: { p: number; color?: string; big?: boolean; children?: React.ReactNode }) {
  return (
    <div className={'ring' + (big ? ' big' : '')} style={{ '--p': p, '--c': color } as React.CSSProperties}>
      <span>{children ?? p + '%'}</span>
    </div>
  );
}

/** Text countdown that calls onDone once when time runs out. */
export function Countdown({ end, skew, onDone }: { end: number; skew: number; onDone?: () => void }) {
  const now = useNow();
  const left = end - (now + skew);
  useEffect(() => { if (left <= 0) onDone?.(); }, [left <= 0]); // eslint-disable-line
  return <>{clock(left)}</>;
}
