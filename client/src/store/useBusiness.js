import { create } from 'zustand';
import api, { DEMO_MODE } from '../lib/api';

/** WhatsApp-Business agent tools: product catalog, labels, quick replies. */
export const useBusiness = create((set, get) => ({
  products: [],
  labels: [],
  quickReplies: [],
  canManage: false,
  loaded: false,

  load: async () => {
    if (DEMO_MODE) return;
    try {
      const [cat, lab, qr] = await Promise.all([
        api.get('/catalog/mine'),
        api.get('/agent/labels'),
        api.get('/agent/quick-replies'),
      ]);
      set({
        products: cat.data.products || [],
        labels: lab.data.labels || [],
        quickReplies: qr.data.quickReplies || [],
        canManage: !!cat.data.canManage,
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  // ── Catalog ──
  addProduct: async (body) => {
    const { data } = await api.post('/catalog', body);
    set((s) => ({ products: [data.product, ...s.products] }));
    return data.product;
  },
  updateProduct: async (id, body) => {
    const { data } = await api.patch(`/catalog/${id}`, body);
    set((s) => ({ products: s.products.map((p) => (p._id === id ? data.product : p)) }));
  },
  deleteProduct: async (id) => {
    await api.delete(`/catalog/${id}`);
    set((s) => ({ products: s.products.filter((p) => p._id !== id) }));
  },
  shareProduct: async (id, chatId) => {
    const { data } = await api.post(`/catalog/${id}/share`, { chatId });
    return data.message;
  },
  browseCatalog: async (workspaceId) => {
    const { data } = await api.get(`/catalog/${workspaceId}`);
    return data;
  },

  // ── Labels ──
  addLabel: async (name, color) => {
    const { data } = await api.post('/agent/labels', { name, color });
    set((s) => ({ labels: [...s.labels, data.label] }));
    return data.label;
  },
  deleteLabel: async (id) => {
    await api.delete(`/agent/labels/${id}`);
    set((s) => ({ labels: s.labels.filter((l) => l._id !== id) }));
  },
  applyLabel: async (id, chatId, apply = true) => {
    await api.post(`/agent/labels/${id}/apply`, { chatId, apply });
  },
  chatLabels: async (chatId) => {
    const { data } = await api.get(`/agent/labels/chat/${chatId}`);
    return data.labels || [];
  },

  // ── Quick replies ──
  addQuickReply: async (shortcut, text) => {
    const { data } = await api.post('/agent/quick-replies', { shortcut, text });
    set((s) => ({ quickReplies: [...s.quickReplies, data.quickReply] }));
    return data.quickReply;
  },
  updateQuickReply: async (id, body) => {
    const { data } = await api.patch(`/agent/quick-replies/${id}`, body);
    set((s) => ({ quickReplies: s.quickReplies.map((q) => (q._id === id ? data.quickReply : q)) }));
  },
  deleteQuickReply: async (id) => {
    await api.delete(`/agent/quick-replies/${id}`);
    set((s) => ({ quickReplies: s.quickReplies.filter((q) => q._id !== id) }));
  },

  quickReplyByShortcut: (shortcut) => get().quickReplies.find((q) => q.shortcut === shortcut.replace(/^\//, '')),
}));
