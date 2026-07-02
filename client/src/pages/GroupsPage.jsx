import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Users,
  Sparkles,
  ArrowRight,
  MessageSquare,
  Layers,
} from 'lucide-react';

import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { cn, formatChatTime, gradientFor } from '@/lib/utils';
import { useUI } from '@/store/useUI';
import { CHATS, USER_MAP, ME } from '@/lib/demoData';

/* ── Motion presets ─────────────────────────────────────────── */
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const cardRise = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 24 } },
};

export default function GroupsPage() {
  const navigate = useNavigate();
  const openModal = useUI((s) => s.openModal);

  const groups = useMemo(() => CHATS.filter((c) => c.isGroup), []);
  const memberOfGroups = useMemo(
    () => groups.filter((g) => g.members?.includes(ME._id)),
    [groups]
  );

  const totalMembers = useMemo(() => {
    const set = new Set();
    groups.forEach((g) => g.members?.forEach((m) => set.add(m)));
    return set.size;
  }, [groups]);

  const openGroup = () => navigate('/');

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        {/* ── Header ─────────────────────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              <span className="gradient-text">Groups</span>
            </h1>
            <p className="mt-1 text-sm text-content-muted">
              Spaces where your people gather and ideas take shape.
            </p>
          </div>

          <Button size="md" onClick={() => openModal('createGroup')} className="shrink-0">
            <Plus size={18} />
            New group
          </Button>
        </motion.header>

        {/* ── Discover / stats strip ─────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="glass-strong relative mt-6 overflow-hidden rounded-3xl p-5 shadow-soft md:p-6"
        >
          {/* Ambient gradient glow */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-gradient opacity-20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-10 h-40 w-40 rounded-full bg-cyan-500/20 blur-3xl" />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
                <Sparkles size={22} />
              </span>
              <div>
                <p className="text-sm font-semibold text-content">Discover your groups</p>
                <p className="text-xs text-content-muted">
                  You&apos;re part of {memberOfGroups.length} of {groups.length} spaces.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Stat icon={Layers} value={groups.length} label="Groups" />
              <Stat icon={Users} value={totalMembers} label="Members" />
            </div>
          </div>
        </motion.section>

        {/* ── Grid / empty state ─────────────────────────────── */}
        {memberOfGroups.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-border">
            <EmptyState
              icon={Users}
              title="No groups yet"
              description="Create your first group to start collaborating with your favorite people."
              action={
                <Button onClick={() => openModal('createGroup')}>
                  <Plus size={18} />
                  Create a group
                </Button>
              }
            />
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {memberOfGroups.map((group) => (
              <GroupCard key={group._id} group={group} onOpen={openGroup} />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ── Stat pill ──────────────────────────────────────────────── */
function Stat({ icon: Icon, value, label }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-surface/60 px-4 py-2.5">
      <Icon size={18} className="text-brand-500" />
      <div className="leading-tight">
        <p className="text-lg font-bold text-content">{value}</p>
        <p className="text-[11px] font-medium text-content-muted">{label}</p>
      </div>
    </div>
  );
}

/* ── Group card ─────────────────────────────────────────────── */
function GroupCard({ group, onOpen }) {
  const members = group.members || [];
  const resolved = members.map((id) => USER_MAP[id] || (id === ME._id ? ME : null)).filter(Boolean);
  const shown = resolved.slice(0, 4);
  const extra = members.length - shown.length;

  return (
    <motion.div
      variants={cardRise}
      whileHover={{ y: -6 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      onClick={onOpen}
      className="glass group relative flex cursor-pointer flex-col overflow-hidden rounded-3xl shadow-soft transition-shadow hover:shadow-soft-lg"
    >
      {/* Gradient header strip */}
      <div
        className={cn(
          'relative h-24 bg-gradient-to-br',
          gradientFor(group.name || group._id)
        )}
      >
        <div className="absolute inset-0 bg-mesh-dark opacity-40" />
        {group.unreadCount > 0 && (
          <span className="absolute right-3 top-3 grid min-w-[22px] place-items-center rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm">
            {group.unreadCount > 99 ? '99+' : group.unreadCount} new
          </span>
        )}
      </div>

      {/* Overlapping avatar */}
      <div className="-mt-9 px-5">
        <Avatar
          src={group.avatar}
          name={group.name}
          size="lg"
          ring
          className="ring-2 ring-surface"
        />
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col px-5 pb-5 pt-3">
        <h3 className="truncate text-base font-bold text-content">{group.name}</h3>
        <p className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-xs text-content-muted">
          {group.description || 'A space for the crew to stay in sync.'}
        </p>

        {/* Members */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center -space-x-2.5">
            {shown.map((m) => (
              <Avatar
                key={m._id}
                src={m.avatar}
                name={m.name}
                size="xs"
                className="ring-2 ring-surface"
              />
            ))}
            {extra > 0 && (
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-500/15 text-[10px] font-bold text-brand-600 ring-2 ring-surface dark:text-brand-300">
                +{extra}
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-content-muted">
            <Users size={13} />
            {members.length}
          </span>
        </div>

        {/* Last message preview */}
        {group.lastMessage && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-surface-2/70 p-2.5">
            <MessageSquare size={14} className="mt-0.5 shrink-0 text-brand-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-content-muted">{group.lastMessage.content}</p>
            </div>
            <span className="shrink-0 text-[10px] text-content-muted/70">
              {formatChatTime(group.lastMessage.createdAt)}
            </span>
          </div>
        )}

        {/* Open action */}
        <Button
          size="md"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="mt-4 w-full"
        >
          Open
          <ArrowRight
            size={17}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Button>
      </div>
    </motion.div>
  );
}
