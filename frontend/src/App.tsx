import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, API_BASE } from './api/client';
import type { Attendance, Settings, Student } from './api/types';
import QrScanner from './components/QrScanner';
import { useAuth, type AppPage } from './context/AuthContext';

const NAV: Array<{ page: AppPage; path: string; label: string }> = [
  { page: 'DASHBOARD', path: 'dashboard', label: 'Dashboard' },
  { page: 'SCAN', path: 'scan', label: 'Scan Chapel' },
  { page: 'PEOPLE', path: 'students', label: 'Students' },
  { page: 'IMPORT', path: 'sync', label: 'Roster & Sync' },
  { page: 'TRANSACTIONS', path: 'attendance', label: 'Attendance Log' },
  { page: 'REPORTS', path: 'reports', label: 'Reports' },
  { page: 'SETTINGS', path: 'settings', label: 'Settings' },
  { page: 'USER_MANAGEMENT', path: 'users', label: 'Users' }
];

function fullName(student?: Student | null) {
  return student ? `${student.firstName} ${student.lastName}`.trim() : 'Unknown student';
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function dateInput(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try { await login(username, password); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in.'); }
  }
  return <main className="login-shell">
    <form className="login-card" onSubmit={submit}>
      <div className="brand-mark">SA</div>
      <p className="eyebrow">Sunnydale Adventist Academy</p>
      <h1>Chapel Attendance</h1>
      <p className="muted">Sign in to open the attendance station.</p>
      <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      <button className="primary" type="submit">Sign in</button>
      {error && <p className="notice error">{error}</p>}
    </form>
  </main>;
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const allowed = NAV.filter((item) => user?.allowedPages.includes(item.page));
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark small">SA</div><div><strong>Chapel Attendance</strong><span>Sunnydale Academy</span></div></div>
      <nav>{allowed.map((item) => <NavLink key={item.page} to={`/${item.path}`}>{item.label}</NavLink>)}</nav>
      <div className="sidebar-footer"><span>{user?.username} · {user?.role}</span><button className="link-button" onClick={() => void logout()}>Sign out</button></div>
    </aside>
    <div className="content-shell">
      <header className="mobile-header"><strong>Chapel Attendance</strong><button className="link-button" onClick={() => void logout()}>Sign out</button></header>
      <nav className="mobile-nav">{allowed.map((item) => <NavLink key={item.page} to={`/${item.path}`}>{item.label}</NavLink>)}</nav>
      <main className="page">{children}</main>
    </div>
  </div>;
}

function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-title"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

type DashboardData = {
  counts: { today: number; week: number; month: number; year: number; activeStudents: number; failedToday: number };
  recent: Attendance[];
};

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => { void api<DashboardData>('/dashboard').then(setData); }, []);
  return <>
    <PageTitle title="Attendance overview" subtitle="A live view of chapel participation." />
    <div className="stat-grid">
      {([['Today', data?.counts.today], ['This week', data?.counts.week], ['This month', data?.counts.month], ['This year', data?.counts.year], ['Active students', data?.counts.activeStudents], ['Rejected today', data?.counts.failedToday]] as const).map(([label, value]) =>
        <article className="stat-card" key={label}><span>{label}</span><strong>{value ?? '—'}</strong></article>)}
    </div>
    <section className="panel"><h2>Recent scans</h2><AttendanceTable rows={data?.recent || []} compact /></section>
  </>;
}

type ScanResult = { ok: boolean; error?: string; reason?: string; student?: Student; attendanceDate?: string; totals?: { week: number; month: number; year: number; allTime: number } };

function ScanStation() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<'usb' | 'camera'>('usb');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState('');
  const [matches, setMatches] = useState<Student[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void api<Settings>('/settings').then(setSettings); }, []);
  useEffect(() => {
    if (!lookup.trim()) { setMatches([]); return; }
    const timer = window.setTimeout(() => void api<Student[]>(`/scan/students?q=${encodeURIComponent(lookup)}`).then(setMatches), 250);
    return () => window.clearTimeout(timer);
  }, [lookup]);

  function tone(success: boolean) {
    if (!settings?.enableSounds) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = success ? 880 : 220;
    gain.gain.setValueAtTime(0.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.2);
  }

  async function record(scannedValue: string) {
    if (busy || !scannedValue.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/scan`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scannedValue: scannedValue.trim() }) });
      const payload = await response.json() as ScanResult;
      setResult(payload); tone(payload.ok);
    } catch { setResult({ ok: false, error: 'Unable to reach the attendance server.' }); tone(false); }
    finally { setBusy(false); setValue(''); window.setTimeout(() => inputRef.current?.focus(), 50); }
  }

  return <>
    <PageTitle title="Scan chapel attendance" subtitle="Use a USB scanner, camera, student ID, or name lookup." />
    <div className="segmented"><button className={mode === 'usb' ? 'active' : ''} onClick={() => setMode('usb')}>USB scanner / ID</button><button className={mode === 'camera' ? 'active' : ''} onClick={() => setMode('camera')}>Camera</button></div>
    {mode === 'camera' && <QrScanner onResult={(text) => void record(text)} onError={(error) => setResult({ ok: false, error })} cooldownMs={(settings?.scannerCooldownSeconds || 1) * 1000} diagnosticsEnabled={settings?.scannerDiagnosticsEnabled} selectedScannerMode="camera" />}
    {mode === 'usb' && <section className="panel scan-entry"><form onSubmit={(event) => { event.preventDefault(); void record(value); }}><label>Scan barcode or enter student ID<input ref={inputRef} className="scan-input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus autoComplete="off" placeholder="Ready to scan…" /></label><button className="primary" disabled={busy}>{busy ? 'Recording…' : 'Check in'}</button></form><p className="muted">Most USB barcode scanners type the ID and press Enter automatically.</p></section>}
    {result && <section className={`scan-result ${result.ok ? 'success' : 'error'}`}>
      <strong>{result.ok ? `Checked in: ${fullName(result.student)}` : result.error}</strong>
      {result.student?.grade && <span>Grade {result.student.grade}</span>}
      {result.totals && <div className="mini-stats"><span><b>{result.totals.week}</b> week</span><span><b>{result.totals.month}</b> month</span><span><b>{result.totals.year}</b> year</span><span><b>{result.totals.allTime}</b> all time</span></div>}
    </section>}
    <section className="panel"><h2>Find by name</h2><input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Start typing a name, ID, or barcode" />
      {matches.length > 0 && <div className="lookup-list">{matches.map((student) => <button key={student.id} onClick={() => void record(student.studentId)}><span><strong>{fullName(student)}</strong><small>{student.studentId}{student.grade ? ` · Grade ${student.grade}` : ''}</small></span><b>Check in</b></button>)}</div>}
    </section>
  </>;
}

const emptyStudent = { studentId: '', barcode: '', firstName: '', lastName: '', grade: '', active: true, notes: '' };

function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [query, setQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [form, setForm] = useState(emptyStudent);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  async function load() { setStudents(await api<Student[]>(`/students?q=${encodeURIComponent(query)}&includeInactive=${includeInactive}`)); }
  useEffect(() => { const timer = window.setTimeout(() => void load(), 150); return () => window.clearTimeout(timer); }, [query, includeInactive]);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await api(editing ? `/students/${editing}` : '/students', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, barcode: form.barcode || form.studentId }) });
      setForm(emptyStudent); setEditing(null); setMessage('Student saved.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save student.'); }
  }
  function edit(student: Student) { setEditing(student.id); setForm({ studentId: student.studentId, barcode: student.barcode, firstName: student.firstName, lastName: student.lastName, grade: student.grade || '', active: student.active, notes: student.notes || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  return <>
    <PageTitle title="Students" subtitle="Manage IDs, barcodes, status, and attendance totals." />
    <section className="panel"><h2>{editing ? 'Edit student' : 'Add student'}</h2><form className="form-grid" onSubmit={save}>
      <label>Student ID<input required value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} /></label>
      <label>Barcode<input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Defaults to student ID" /></label>
      <label>First name<input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
      <label>Last name<input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
      <label>Grade<input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} /></label>
      <label className="checkbox"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
      <div className="button-row"><button className="primary">{editing ? 'Save changes' : 'Add student'}</button>{editing && <button type="button" className="secondary" onClick={() => { setEditing(null); setForm(emptyStudent); }}>Cancel</button>}</div>
    </form>{message && <p className="muted">{message}</p>}</section>
    <section className="panel"><div className="toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search students" /><label className="checkbox"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Include inactive</label></div>
      <div className="table-wrap"><table><thead><tr><th>Student</th><th>ID / Barcode</th><th>Grade</th><th>Week</th><th>Month</th><th>Year</th><th>All time</th><th></th></tr></thead><tbody>{students.map((student) => <tr key={student.id} className={!student.active ? 'inactive' : ''}><td><strong>{fullName(student)}</strong>{!student.active && <small>Inactive</small>}</td><td>{student.studentId}<small>{student.barcode !== student.studentId ? student.barcode : ''}</small></td><td>{student.grade || '—'}</td><td>{student.totals?.week ?? 0}</td><td>{student.totals?.month ?? 0}</td><td>{student.totals?.year ?? 0}</td><td>{student.totals?.allTime ?? 0}</td><td><button className="text-button" onClick={() => edit(student)}>Edit</button></td></tr>)}</tbody></table></div>
    </section>
  </>;
}

type GoogleStatus = { enabled: boolean; autoSyncEnabled: boolean; lastSyncAt: string | null; lastSyncSummary: string | null; credentialsConfigured: boolean };

function SyncPage() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() { setStatus(await api<GoogleStatus>('/google/status')); }
  useEffect(() => { void load(); }, []);
  async function sync() { setBusy(true); setMessage(''); try { const result = await api<{ imported: number; attendanceRowsAppended: number; summariesUpdated: number; failed: number }>('/google/sync', { method: 'POST' }); setMessage(`Sync complete: ${result.imported} roster rows imported, ${result.attendanceRowsAppended} attendance rows exported, and ${result.summariesUpdated} summaries updated.${result.failed ? ` ${result.failed} rows failed.` : ''}`); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Sync failed.'); } finally { setBusy(false); } }
  async function upload(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { const response = await fetch(`${API_BASE}/import/csv`, { method: 'POST', credentials: 'include', body: form }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Import failed.'); setMessage(`Imported ${payload.imported} students. ${payload.failed ? `${payload.failed} rows failed.` : ''}`); event.currentTarget.reset(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed.'); } finally { setBusy(false); } }
  return <>
    <PageTitle title="Roster & Google Sync" subtitle="Import students and keep attendance totals available in Google Sheets." action={<a className="button secondary" href={`${API_BASE}/google/template`}>Download template</a>} />
    <div className="two-column"><section className="panel"><h2>Google Sheets</h2><div className={`status-pill ${status?.enabled ? 'good' : ''}`}>{status?.enabled ? 'Enabled' : 'Disabled'}</div><p>{status?.lastSyncSummary || 'No sync has run yet.'}</p>{status?.lastSyncAt && <p className="muted">Last synced {formatDateTime(status.lastSyncAt)}</p>}<p className="muted">Credentials: {status?.credentialsConfigured ? 'configured' : 'not configured'} · Automatic sync: {status?.autoSyncEnabled ? 'on' : 'off'}</p><button className="primary" disabled={busy || !status?.enabled} onClick={() => void sync()}>{busy ? 'Syncing…' : 'Sync now'}</button></section>
      <section className="panel"><h2>CSV roster import</h2><p className="muted">Headers: Student ID, First Name, Last Name, Grade, Active, Barcode. Existing IDs are updated.</p><form onSubmit={upload}><input type="file" name="file" accept=".csv,text/csv" required /><button className="secondary" disabled={busy}>Import CSV</button></form></section></div>
    <section className="panel"><h2>Google Sheet layout</h2><ol><li>Share the Sheet with the configured Google service-account email as an Editor.</li><li>In Settings, enter the Spreadsheet ID and enable Google Sheets.</li><li>The <b>Students</b> tab is the roster source. The app adds weekly, monthly, yearly, and all-time totals.</li><li>The <b>Attendance</b> tab is an append-only log. The <b>Attendance Summary</b> tab is rebuilt on each sync for easy filtering.</li></ol>{message && <p className="notice">{message}</p>}</section>
  </>;
}

function AttendanceTable({ rows, compact = false }: { rows: Attendance[]; compact?: boolean }) {
  if (!rows.length) return <p className="empty">No attendance records yet.</p>;
  return <div className="table-wrap"><table><thead><tr><th>Time</th><th>Student</th><th>ID</th><th>Result</th>{!compact && <><th>Station</th><th>Google</th></>}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDateTime(row.timestamp)}</td><td>{fullName(row.student)}</td><td>{row.student?.studentId || row.scannedValue}</td><td><span className={`result ${row.result.toLowerCase()}`}>{row.result === 'SUCCESS' ? 'Checked in' : (row.failureReason || 'Rejected').replaceAll('_', ' ')}</span></td>{!compact && <><td>{row.stationName || '—'}</td><td>{row.googleSyncedAt ? 'Synced' : row.result === 'SUCCESS' ? 'Pending' : '—'}</td></>}</tr>)}</tbody></table></div>;
}

function AttendanceLog() {
  const [rows, setRows] = useState<Attendance[]>([]); const [query, setQuery] = useState(''); const [result, setResult] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => void api<Attendance[]>(`/attendance?q=${encodeURIComponent(query)}&result=${result}`).then(setRows), 150); return () => window.clearTimeout(timer); }, [query, result]);
  return <><PageTitle title="Attendance log" subtitle="The latest 500 accepted and rejected scans." /><section className="panel"><div className="toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or ID" /><select value={result} onChange={(e) => setResult(e.target.value)}><option value="">All results</option><option value="SUCCESS">Checked in</option><option value="FAILURE">Rejected</option></select></div><AttendanceTable rows={rows} /></section></>;
}

type Report = { from: string; to: string; totalAttendances: number; studentsWithAttendance: number; rows: Array<Student & { count: number; dates: string[] }> };

function Reports() {
  const [from, setFrom] = useState(() => { const date = new Date(); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return dateInput(date); });
  const [to, setTo] = useState(dateInput()); const [report, setReport] = useState<Report | null>(null); const [query, setQuery] = useState('');
  async function load() { setReport(await api<Report>(`/reports?from=${from}&to=${to}`)); }
  useEffect(() => { void load(); }, [from, to]);
  function preset(kind: 'week' | 'month' | 'year') { const now = new Date(); const start = new Date(now); if (kind === 'week') start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); if (kind === 'month') start.setDate(1); if (kind === 'year') start.setMonth(0, 1); setFrom(dateInput(start)); setTo(dateInput(now)); }
  const rows = report?.rows.filter((row) => fullName(row).toLowerCase().includes(query.toLowerCase()) || row.studentId.toLowerCase().includes(query.toLowerCase())) || [];
  return <><PageTitle title="Attendance reports" subtitle="Choose any date range or jump to the current week, month, or year." /><section className="panel"><div className="toolbar wrap"><button className="secondary" onClick={() => preset('week')}>This week</button><button className="secondary" onClick={() => preset('month')}>This month</button><button className="secondary" onClick={() => preset('year')}>This year</button><label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div></section>
    <div className="stat-grid two"><article className="stat-card"><span>Total check-ins</span><strong>{report?.totalAttendances ?? '—'}</strong></article><article className="stat-card"><span>Students attending</span><strong>{report?.studentsWithAttendance ?? '—'}</strong></article></div>
    <section className="panel"><div className="toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter students" /><button className="secondary" onClick={() => window.print()}>Print report</button></div><div className="table-wrap"><table><thead><tr><th>Student</th><th>ID</th><th>Grade</th><th>Chapels attended</th><th>Dates</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{fullName(row)}</td><td>{row.studentId}</td><td>{row.grade || '—'}</td><td><strong>{row.count}</strong></td><td className="dates">{row.dates.join(', ') || '—'}</td></tr>)}</tbody></table></div></section></>;
}

function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null); const [message, setMessage] = useState('');
  useEffect(() => { void api<Settings>('/settings').then(setSettings); }, []);
  if (!settings) return <p>Loading settings…</p>;
  async function save(event: FormEvent) { event.preventDefault(); try { setSettings(await api<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(settings) })); setMessage('Settings saved.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save settings.'); } }
  const text = (key: keyof Settings) => (event: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, [key]: event.target.value });
  const check = (key: keyof Settings) => (event: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, [key]: event.target.checked });
  return <><PageTitle title="Settings" subtitle="Configure the scanner, duplicate rules, and Google Sheet connection." /><form className="stack" onSubmit={save}><section className="panel"><h2>General</h2><div className="form-grid"><label>School name<input value={settings.schoolName} onChange={text('schoolName')} /></label><label>Timezone<input value={settings.timezone} onChange={text('timezone')} placeholder="America/Chicago" /></label><label>Station name<input value={settings.stationName} onChange={text('stationName')} /></label><label>Scanner cooldown (seconds)<input type="number" min="0.25" step="0.25" value={settings.scannerCooldownSeconds} onChange={(e) => setSettings({ ...settings, scannerCooldownSeconds: Number(e.target.value) })} /></label></div><div className="check-grid"><label className="checkbox"><input type="checkbox" checked={settings.oneAttendancePerDay} onChange={check('oneAttendancePerDay')} /> Count each student only once per day</label><label className="checkbox"><input type="checkbox" checked={settings.enableSounds} onChange={check('enableSounds')} /> Scanner sounds</label><label className="checkbox"><input type="checkbox" checked={settings.scannerDiagnosticsEnabled} onChange={check('scannerDiagnosticsEnabled')} /> Camera diagnostics</label></div></section>
    <section className="panel"><h2>Google Sheets</h2><div className="check-grid"><label className="checkbox"><input type="checkbox" checked={settings.googleSheetsEnabled} onChange={check('googleSheetsEnabled')} /> Enable Google Sheets</label><label className="checkbox"><input type="checkbox" checked={settings.googleAutoSyncEnabled} onChange={check('googleAutoSyncEnabled')} /> Automatic sync</label></div><div className="form-grid"><label>Spreadsheet ID<input value={settings.googleSheetId} onChange={text('googleSheetId')} /></label><label>Sync every (minutes)<input type="number" min="1" value={settings.googleSyncIntervalMinutes} onChange={(e) => setSettings({ ...settings, googleSyncIntervalMinutes: Number(e.target.value) })} /></label><label>Roster tab<input value={settings.googleRosterTabName} onChange={text('googleRosterTabName')} /></label><label>Attendance log tab<input value={settings.googleAttendanceTabName} onChange={text('googleAttendanceTabName')} /></label><label>Summary tab<input value={settings.googleSummaryTabName} onChange={text('googleSummaryTabName')} /></label></div></section><button className="primary save-button">Save settings</button>{message && <p className="notice">{message}</p>}</form></>;
}

type User = { id: number; username: string; role: 'OWNER' | 'ADMIN' | 'CUSTOM' | 'SCANNER'; allowedPages: AppPage[] };

function Users() {
  const [users, setUsers] = useState<User[]>([]); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState<User['role']>('SCANNER'); const [message, setMessage] = useState('');
  async function load() { setUsers(await api<User[]>('/users')); } useEffect(() => { void load(); }, []);
  async function create(event: FormEvent) { event.preventDefault(); try { await api('/users', { method: 'POST', body: JSON.stringify({ username, password, role, allowedPages: [] }) }); setUsername(''); setPassword(''); setMessage('User created.'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create user.'); } }
  return <><PageTitle title="Users" subtitle="Create scanner-only or administrative logins." /><section className="panel"><h2>Add user</h2><form className="form-grid" onSubmit={create}><label>Username<input required value={username} onChange={(e) => setUsername(e.target.value)} /></label><label>Password<input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>Role<select value={role} onChange={(e) => setRole(e.target.value as User['role'])}><option value="SCANNER">Scanner only</option><option value="ADMIN">Administrator</option></select></label><button className="primary">Create user</button></form>{message && <p className="notice">{message}</p>}</section><section className="panel"><h2>Existing users</h2><div className="table-wrap"><table><thead><tr><th>Username</th><th>Role</th><th>Access</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.username}</td><td>{user.role}</td><td>{user.role === 'SCANNER' ? 'Scan Chapel' : 'Administrative'}</td></tr>)}</tbody></table></div></section></>;
}

function Protected({ page, children }: { page: AppPage; children: ReactNode }) {
  const { user } = useAuth(); return user?.allowedPages.includes(page) ? <Shell>{children}</Shell> : <Navigate to="/" replace />;
}

function HomeRedirect() {
  const { user } = useAuth(); const first = NAV.find((item) => user?.allowedPages.includes(item.page)); return <Navigate to={first ? `/${first.path}` : '/login'} replace />;
}

export default function App() {
  const { user, loading } = useAuth(); if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  const pages: Array<[string, AppPage, ReactNode]> = [['dashboard', 'DASHBOARD', <Dashboard />], ['scan', 'SCAN', <ScanStation />], ['students', 'PEOPLE', <Students />], ['sync', 'IMPORT', <SyncPage />], ['attendance', 'TRANSACTIONS', <AttendanceLog />], ['reports', 'REPORTS', <Reports />], ['settings', 'SETTINGS', <SettingsPage />], ['users', 'USER_MANAGEMENT', <Users />]];
  return <Routes><Route path="/" element={<HomeRedirect />} />{pages.map(([path, page, component]) => <Route key={path} path={`/${path}`} element={<Protected page={page}>{component}</Protected>} />)}<Route path="*" element={<HomeRedirect />} /></Routes>;
}
