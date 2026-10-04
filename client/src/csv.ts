import type { Overview } from './types';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Escapes a single CSV cell value and mitigates spreadsheet formula injection.
 * If a value begins with =, +, -, @, tab (\t), or CR (\r), it is prepended with a single quote.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Generates CSV string for the course report:
 * Columns: Enrolment, Name, Attendance Count, Attendance %, and one column per assignment
 * Assignment values: "Submitted", "Late", or "Missing"
 */
export function generateCourseCsv(d: Overview): string {
  const headers = ['Enrolment', 'Name', 'Attendance Count', 'Attendance %', ...d.asgs.map(a => a.title)];

  const rows = d.roster.map(student => {
    const r = d.report.find(item => same(item.en, student.en));
    const attCount = r ? r.att : 0;
    const attPct = (d.total > 0 ? Math.round((attCount * 100) / d.total) : 0) + '%';
    const asgStatuses = d.asgs.map(a => {
      const sub = a.subs.find(s => same(s.en, student.en));
      if (!sub) return 'Missing';
      return sub.t > a.due ? 'Late' : 'Submitted';
    });
    return [
      student.en,
      student.name,
      attCount,
      attPct,
      ...asgStatuses
    ];
  });

  return [headers, ...rows]
    .map(row => row.map(escapeCsvCell).join(','))
    .join('\r\n');
}

export function downloadCourseCsv(d: Overview, courseName: string): void {
  const csvContent = generateCourseCsv(d);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${courseName.replace(/[^a-zA-Z0-9_-]/g, '_')}_report.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
