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

  create: async ({ title, description = '', startAt, durationMinutes = 30, type = 'video', recurrence = 'none', participants = [], timezone, settings, inviteEmails = [] }) => {
    if (DEMO_MODE) {
      const me = useAuth.getState().user;
      const meeting = {
        _id: `m-${Date.now()}`, title, description, host: me, participants: [],
        startAt, durationMinutes, type, recurrence, timezone, settings, status: 'scheduled',
        link: `/meet/${Math.random().toString(36).slice(2, 10)}`,
      };
      set((s) => ({ meetings: [meeting, ...s.meetings] }));
      return meeting;
    }
    const { data } = await api.post('/meetings', { title, description, startAt, durationMinutes, type, recurrence, participants, timezone, settings, inviteEmails });
    set((s) => ({ meetings: [data.meeting, ...s.meetings].sort((a, b) => new Date(a.startAt) - new Date(b.startAt)) }));
    return data.meeting;
  },

  rsvp: async (id, response) => {
    if (DEMO_MODE) return;
    const { data } = await api.post(`/meetings/${id}/rsvp`, { response });
    set((s) => ({ meetings: s.meetings.map((m) => (m._id === id ? data.meeting : m)) }));
    return data.meeting;
  },

  // Start an instant meeting (no schedule) → a shareable room you can join now.
  createInstant: async (type = 'video') => {
    const { data } = await api.post('/meetings', { type });
    set((s) => ({ meetings: [data.meeting, ...s.meetings] }));
    return data.meeting;
  },

  // Look up a meeting by its shareable room code (before joining the room).
  getByCode: async (code) => {
    const { data } = await api.get(`/meetings/code/${encodeURIComponent(code)}`);
    return data.meeting;
  },

  // Join a meeting via its shareable link (Google-Meet style) → returns the meeting.
  joinByCode: async (code) => {
    const { data } = await api.post(`/meetings/code/${encodeURIComponent(code)}/join`);
    return data.meeting;
  },

  // Host-only attendance record: date/time, duration, who attended (name/email).
  getReport: async (id) => {
    const { data } = await api.get(`/meetings/${id}/report`);
    return data.report;
  },
}));
