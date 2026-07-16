import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';

/** The current user's workspace (org) — members, invite link, role. Real mode only. */
export const useWorkspace = create((set) => ({
  workspace: null,
  members: [],
  myRole: 'member',
  memberCount: 0,
  loading: false,

  load: async () => {
    if (DEMO_MODE) return;
    set({ loading: true });
    try {
      const { data } = await api.get('/workspaces/me');
      set({ workspace: data.workspace, members: data.members || [], myRole: data.myRole, memberCount: data.memberCount });
    } catch {
      /* not in a workspace / offline */
    } finally {
      set({ loading: false });
    }
  },

  rename: async (name) => {
    const { data } = await api.patch('/workspaces/me', { name });
    set((s) => ({ workspace: { ...s.workspace, ...data.workspace } }));
  },

  // Update business storefront profile and/or auto-replies (owner/admin).
  updateBusiness: async (patch) => {
    const { data } = await api.patch('/workspaces/me', patch);
    set((s) => ({ workspace: { ...s.workspace, ...data.workspace } }));
    return data.workspace;
  },

  rotateInvite: async () => {
    const { data } = await api.post('/workspaces/me/invite/rotate');
    set((s) => ({ workspace: { ...s.workspace, ...data.workspace } }));
    return data.workspace;
  },

  setMemberRole: async (userId, role) => {
    await api.patch(`/workspaces/me/members/${userId}/role`, { role });
    set((s) => ({ members: s.members.map((m) => (m._id === userId ? { ...m, workspaceRole: role } : m)) }));
  },

  // Hand ownership to another member; the current owner steps down to admin.
  transferOwnership: async (userId) => {
    await api.post('/workspaces/me/transfer', { userId });
    set((s) => ({
      myRole: 'admin',
      members: s.members.map((m) => {
        if (m._id === userId) return { ...m, workspaceRole: 'owner' };
        if (m.workspaceRole === 'owner') return { ...m, workspaceRole: 'admin' };
        return m;
      }),
    }));
  },

  // Pause (suspend) or resume a member's access. status: 'suspended' | 'active'.
  setMemberStatus: async (userId, status) => {
    const { data } = await api.patch(`/workspaces/me/members/${userId}/status`, { status });
    set((s) => ({
      members: s.members.map((m) => (m._id === userId ? { ...m, accountStatus: data.member.accountStatus } : m)),
    }));
    return data.member;
  },

  // Remove a member from the workspace entirely.
  removeMember: async (userId) => {
    await api.delete(`/workspaces/me/members/${userId}`);
    set((s) => ({
      members: s.members.filter((m) => m._id !== userId),
      memberCount: Math.max(0, (s.memberCount || 1) - 1),
    }));
  },
}));
