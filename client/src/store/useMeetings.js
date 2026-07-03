import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';
import { MEETINGS } from '../lib/demoData';
import { useAuth } from './useAuth';

/** Meetings: schedule, list, RSVP. Real mode → /api/meetings; demo → in-memory. */
export const useMeetings = create((set, get) => ({
  meetings: [],
  loading: false,

  load: async () => {
    if (DEMO_MODE) return set({ meetings: MEETINGS });
    set({ loading: true });
    try {
      const { data } = await api.get('/meetings');
      set({ meetings: data.meetings || [] });
    } finally {
      set({ loading: false });
    }
  },

  create: async ({ title, description = '', startAt, durationMinutes = 30, type = 'video', recurrence = 'none', participants = [] }) => {
    if (DEMO_MODE) {
      const me = useAuth.getState().user;
      const meeting = {
        _id: `m-${Date.now()}`, title, description, host: me, participants: [],
        startAt, durationMinutes, type, recurrence, status: 'scheduled',
        link: `/meet/${Math.random().toString(36).slice(2, 10)}`,
      };
      set((s) => ({ meetings: [meeting, ...s.meetings] }));
      return meeting;
    }
    const { data } = await api.post('/meetings', { title, description, startAt, durationMinutes, type, recurrence, participants });
    set((s) => ({ meetings: [data.meeting, ...s.meetings].sort((a, b) => new Date(a.startAt) - new Date(b.startAt)) }));
    return data.meeting;
  },

  rsvp: async (id, response) => {
    if (DEMO_MODE) return;
    const { data } = await api.post(`/meetings/${id}/rsvp`, { response });
    set((s) => ({ meetings: s.meetings.map((m) => (m._id === id ? data.meeting : m)) }));
    return data.meeting;
  },
}));
