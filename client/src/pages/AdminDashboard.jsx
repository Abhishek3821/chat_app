import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
} from 'recharts';
import {
  Users,
  Activity,
  MessagesSquare,
  Layers,
  PhoneCall,
  Flag,
  TrendingUp,
  ShieldAlert,
  Ban,
  ShieldCheck,
  PauseCircle,
  Check,
  X,
} from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import api, { DEMO_MODE } from '@/lib/api';
import { ADMIN_STATS, ADMIN_USERS, ADMIN_REPORTS } from '@/lib/demoData';
import { format } from 'date-fns';

/* Motion presets */
const rise = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};
const stagger = { animate: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } };

/* Brand chart palette */
const C = { indigo: '#6366F1', violet: '#8B5CF6', cyan: '#06B6D4' };

/* Format large numbers → 12.8K / 1.2M */
function compact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

/* ── Stat cards ───────────────────────────────────────────────── */
const STAT_CARDS = [
  { key: 'totalUsers', label: 'Total Users', icon: Users, trend: '+8.2%' },
  { key: 'activeUsers', label: 'Active Now', icon: Activity, trend: '+3.1%' },
  { key: 'totalGroups', label: 'Total Groups', icon: Layers, trend: '+5.4%' },
  { key: 'totalMessages', label: 'Total Messages', icon: MessagesSquare, trend: '+12.7%' },
  { key: 'totalCalls', label: 'Total Calls', icon: PhoneCall, trend: '+6.9%' },
  { key: 'openReports', label: 'Open Reports', icon: Flag, trend: '-2 today', muted: true },
];

function StatCard({ label, value, icon: Icon, trend, muted }) {
  return (
    <motion.div
      variants={rise}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      className="glass group rounded-3xl p-5 shadow-soft transition-shadow hover:shadow-soft-lg"
    >
      <div className="flex items-start justify-between">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
          <Icon size={22} />
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold',
            muted ? 'bg-content/5 text-content-muted' : 'bg-emerald-500/10 text-emerald-500'
          )}
        >
          {!muted && <TrendingUp size={12} />}
          {trend}
        </span>
      </div>
      <p className="mt-4 font-display text-3xl font-extrabold tracking-tight text-content">{compact(value)}</p>
      <p className="mt-0.5 text-sm text-content-muted">{label}</p>
      {!muted && <p className="mt-1 text-[11px] font-medium text-content-muted">this week</p>}
    </motion.div>
  );
}

/* ── Chart tooltip ────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label, suffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl px-3 py-2 shadow-soft-lg">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-content">
        {payload[0].value.toLocaleString()} {suffix}
      </p>
    </div>
  );
}

const axisProps = {
  stroke: 'rgb(var(--content-muted))',
  tick: { fill: 'rgb(var(--content-muted))', fontSize: 11 },
  tickLine: false,
  axisLine: false,
};

function ChartCard({ title, subtitle, children }) {
  return (
    <motion.div variants={rise} className="glass rounded-3xl p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-content">{title}</h3>
          {subtitle && <p className="text-xs text-content-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="h-[260px] w-full">{children}</div>
    </motion.div>
  );
}

/* ── Status badge ─────────────────────────────────────────────── */
const STATUS_STYLES = {
  active: 'bg-emerald-500/10 text-emerald-500 ring-emerald-500/20',
  suspended: 'bg-amber-500/10 text-amber-500 ring-amber-500/20',
  banned: 'bg-red-500/10 text-red-500 ring-red-500/20',
  open: 'bg-red-500/10 text-red-500 ring-red-500/20',
  reviewing: 'bg-amber-500/10 text-amber-500 ring-amber-500/20',
  resolved: 'bg-emerald-500/10 text-emerald-500 ring-emerald-500/20',
  dismissed: 'bg-content/5 text-content-muted ring-border',
};

function StatusBadge({ status }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1',
        STATUS_STYLES[status] || STATUS_STYLES.dismissed
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'active' || status === 'resolved'
            ? 'bg-emerald-500'
            : status === 'suspended' || status === 'reviewing'
              ? 'bg-amber-500'
              : status === 'banned' || status === 'open'
                ? 'bg-red-500'
                : 'bg-content-muted'
        )}
      />
      {status}
    </span>
  );
}

/* ── User management table ────────────────────────────────────── */
function UserManagement() {
  const [users, setUsers] = useState(DEMO_MODE ? ADMIN_USERS : []);

  useEffect(() => {
    if (DEMO_MODE) return;
    api
      .get('/admin/users')
      .then(({ data }) => setUsers(data.users || []))
      .catch((err) => toast.error(err.message || 'Could not load users.'));
  }, []);

  const setStatus = async (id, status, verb) => {
    const name = users.find((u) => u._id === id)?.name;
    if (!DEMO_MODE) {
      try {
        await api.patch(`/admin/users/${id}/status`, { accountStatus: status });
      } catch (err) {
        toast.error(err.message || 'Could not update the account.');
        return;
      }
    }
    setUsers((list) => list.map((u) => (u._id === id ? { ...u, accountStatus: status } : u)));
    toast.success(`${name} ${verb}`);
  };

  return (
    <motion.div variants={rise} className="glass rounded-3xl p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-content">User Management</h3>
          <p className="text-xs text-content-muted">{users.length} accounts</p>
        </div>
      </div>

      <div className="-mx-2 overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-content-muted">
              <th className="px-3 py-2 font-semibold">User</th>
              <th className="px-3 py-2 font-semibold">Email</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Joined</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u._id}
                className="border-t border-border transition-colors hover:bg-content/[0.03]"
              >
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar src={u.avatar} name={u.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-content">{u.name}</p>
                      <p className="truncate text-xs text-content-muted">@{u.username}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-sm text-content-muted">{u.email}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={u.accountStatus} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-sm text-content-muted">
                  {format(new Date(u.createdAt), 'd MMM yyyy')}
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-2">
                    {u.accountStatus === 'active' ? (
                      <>
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => setStatus(u._id, 'suspended', 'suspended')}
                          className="!bg-amber-500/10 !text-amber-600 hover:!bg-amber-500/20 dark:!text-amber-400"
                        >
                          <PauseCircle size={15} /> Suspend
                        </Button>
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => setStatus(u._id, 'banned', 'banned')}
                          className="!bg-red-500/10 !text-red-600 hover:!bg-red-500/20 dark:!text-red-400"
                        >
                          <Ban size={15} /> Ban
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="subtle"
                        size="sm"
                        onClick={() => setStatus(u._id, 'active', 'reactivated')}
                        className="!bg-emerald-500/10 !text-emerald-600 hover:!bg-emerald-500/20 dark:!text-emerald-400"
                      >
                        <ShieldCheck size={15} /> Activate
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

/* ── Reports ──────────────────────────────────────────────────── */
function Reports() {
  const [reports, setReports] = useState(DEMO_MODE ? ADMIN_REPORTS : []);

  useEffect(() => {
    if (DEMO_MODE) return;
    api
      .get('/admin/reports')
      .then(({ data }) => setReports(data.reports || []))
      .catch((err) => toast.error(err.message || 'Could not load reports.'));
  }, []);

  const resolve = async (id, status, verb) => {
    if (!DEMO_MODE) {
      try {
        await api.patch(`/admin/reports/${id}`, { status });
      } catch (err) {
        toast.error(err.message || 'Could not update the report.');
        return;
      }
    }
    setReports((list) => list.map((r) => (r._id === id ? { ...r, status } : r)));
    toast.success(`Report ${verb}`);
  };

  const openCount = useMemo(
    () => reports.filter((r) => r.status === 'open' || r.status === 'reviewing').length,
    [reports]
  );

  return (
    <motion.div variants={rise} className="glass rounded-3xl p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-500/10 text-red-500">
            <ShieldAlert size={18} />
          </span>
          <div>
            <h3 className="font-display text-base font-bold text-content">Reports</h3>
            <p className="text-xs text-content-muted">{openCount} awaiting review</p>
          </div>
        </div>
      </div>

      <div className="-mx-2 overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-content-muted">
              <th className="px-3 py-2 font-semibold">Reporter</th>
              <th className="px-3 py-2 font-semibold">Target</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {reports.map((r) => {
                const closed = r.status === 'resolved' || r.status === 'dismissed';
                return (
                  <motion.tr
                    key={r._id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-t border-border transition-colors hover:bg-content/[0.03]"
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={r.reporter?.avatar} name={r.reporter?.name} size="xs" />
                        <span className="text-sm font-medium text-content">{r.reporter?.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={r.targetUser?.avatar} name={r.targetUser?.name} size="xs" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-content">{r.targetUser?.name}</p>
                          <p className="text-[11px] capitalize text-content-muted">{r.targetType}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-sm text-content-muted">{r.reason}</span>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="subtle"
                          size="sm"
                          disabled={closed}
                          onClick={() => resolve(r._id, 'resolved', 'resolved')}
                          className="!bg-emerald-500/10 !text-emerald-600 hover:!bg-emerald-500/20 dark:!text-emerald-400"
                        >
                          <Check size={15} /> Resolve
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={closed}
                          onClick={() => resolve(r._id, 'dismissed', 'dismissed')}
                        >
                          <X size={15} /> Dismiss
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
export default function AdminDashboard() {
  const [stats, setStats] = useState(DEMO_MODE ? ADMIN_STATS : null);

  useEffect(() => {
    if (DEMO_MODE) return;
    api
      .get('/admin/stats')
      .then(({ data }) => setStats(data.stats))
      .catch((err) => toast.error(err.message || 'Could not load admin stats.'));
  }, []);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <motion.div
        variants={stagger}
        initial="initial"
        animate="animate"
        className="mx-auto max-w-6xl space-y-6 p-4 md:p-6"
      >
        {/* Header */}
        <motion.div variants={rise} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-content sm:text-3xl">
              <span className="gradient-text">Admin Dashboard</span>
            </h1>
            <p className="mt-1 text-sm text-content-muted">
              A live pulse of everything happening across ChatConnect.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        </motion.div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STAT_CARDS.map((s) => (
            <StatCard
              key={s.key}
              label={s.label}
              value={stats?.[s.key] ?? 0}
              icon={s.icon}
              trend={s.trend}
              muted={s.muted}
            />
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="User Growth" subtitle="New sign-ups over the last 7 days">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats?.userGrowth || []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="userGrowthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.indigo} stopOpacity={0.45} />
                    <stop offset="60%" stopColor={C.violet} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={C.cyan} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="userGrowthStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={C.indigo} />
                    <stop offset="100%" stopColor={C.violet} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                <XAxis dataKey="_id" {...axisProps} />
                <YAxis {...axisProps} width={40} />
                <RTooltip content={<ChartTooltip suffix="users" />} cursor={{ stroke: C.indigo, strokeWidth: 1, strokeOpacity: 0.3 }} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="url(#userGrowthStroke)"
                  strokeWidth={2.5}
                  fill="url(#userGrowthFill)"
                  dot={false}
                  activeDot={{ r: 5, fill: C.violet, stroke: '#fff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Message Volume" subtitle="Messages sent over the last 7 days">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.messageVolume || []} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
                <defs>
                  <linearGradient id="msgBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.violet} />
                    <stop offset="100%" stopColor={C.cyan} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                <XAxis dataKey="_id" {...axisProps} />
                <YAxis {...axisProps} width={44} tickFormatter={(v) => compact(v)} />
                <RTooltip content={<ChartTooltip suffix="messages" />} cursor={{ fill: 'rgb(var(--content-muted))', fillOpacity: 0.08 }} />
                <Bar dataKey="count" fill="url(#msgBar)" radius={[8, 8, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Tables */}
        <UserManagement />
        <Reports />
      </motion.div>
    </div>
  );
}
