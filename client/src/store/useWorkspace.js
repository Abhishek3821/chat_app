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

  rotateInvite: async () => {
    const { data } = await api.post('/workspaces/me/invite/rotate');
    set((s) => ({ workspace: { ...s.workspace, ...data.workspace } }));
    return data.workspace;
  },

  setMemberRole: async (userId, role) => {
    await api.patch(`/workspaces/me/members/${userId}/role`, { role });
    set((s) => ({ members: s.members.map((m) => (m._id === userId ? { ...m, workspaceRole: role } : m)) }));
  },
}));
