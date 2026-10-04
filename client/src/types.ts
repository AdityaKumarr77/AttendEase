export type CourseLite = { id: string; name: string };
export type Person = { en: string; name: string };
export type StudentView = {
  now: number; me: Person | null; total: number; attended: number;
  open: { start: number; endsAt: number; marked: boolean } | null;
  asgs: { id: string; title: string; due: number; sub: { t: number; name: string } | null }[];
};
export type Overview = {
  now: number; roster: Person[]; total: number;
  open: { id: string; code: string; start: number; endsAt: number; count: number } | null;
  sessions: { start: number; count: number }[];
  asgs: { id: string; title: string; due: number; subs: { en: string; name: string; t: number; file: string; orig: string }[] }[];
  report: { en: string; name: string; att: number; sub: number }[];
};
export type Notify = (msg: string, bad?: boolean) => void;

export type TeacherInfo = { id: string; email: string; name?: string };
export type VerifyResult = {
  ok: boolean;
  role: 'admin' | 'teacher';
  teacher?: TeacherInfo;
};
