import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, X } from 'lucide-react';

/**
 * Tenor GIF picker. Needs a free Tenor (Google) API key in VITE_TENOR_KEY —
 * without it the panel explains how to enable it rather than silently failing.
 * A picked GIF is an https URL sent as a normal image attachment.
 */
const TENOR_KEY = import.meta.env.VITE_TENOR_KEY || '';
const TENOR = 'https://tenor.googleapis.com/v2';

export default function GifPicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const fetchGifs = async (query) => {
    if (!TENOR_KEY) return;
    setLoading(true);
    setError('');
    try {
      const url = query
        ? `${TENOR}/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&client_key=chatconnect&limit=24&media_filter=tinygif,gif`
        : `${TENOR}/featured?key=${TENOR_KEY}&client_key=chatconnect&limit=24&media_filter=tinygif,gif`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(
        (data.results || []).map((r) => ({
          id: r.id,
          preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
          full: r.media_formats?.gif?.url || r.media_formats?.tinygif?.url,
          dims: r.media_formats?.gif?.dims || [],
        })).filter((g) => g.full)
      );
    } catch {
      setError('Could not load GIFs. Check your connection or Tenor key.');
    } finally {
      setLoading(false);
    }
  };

  // Load featured on open; debounce search as the user types.
  useEffect(() => { fetchGifs(''); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (!TENOR_KEY) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchGifs(q.trim()), 400);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="glass-strong flex h-[380px] w-[320px] flex-col overflow-hidden rounded-2xl shadow-soft-lg">
      <div className="flex items-center gap-2 border-b border-border p-2.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted" size={15} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search GIFs on Tenor"
            className="ring-brand h-9 w-full rounded-xl border border-border bg-surface-2 pl-8 pr-2 text-sm placeholder:text-content-muted"
          />
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-content-muted hover:bg-content/10 hover:text-content"><X size={16} /></button>
      </div>

      {!TENOR_KEY ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm font-medium text-content">GIF search needs a Tenor key</p>
          <p className="text-xs text-content-muted">Get a free key at Google Cloud (Tenor API), then set <span className="font-mono">VITE_TENOR_KEY</span> and rebuild.</p>
        </div>
      ) : loading && items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-brand-500" size={22} /></div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-content-muted">{error}</div>
      ) : (
        <div className="scrollbar-thin grid flex-1 grid-cols-2 gap-1.5 overflow-y-auto p-2">
          {items.map((g) => (
            <button
              key={g.id}
              onClick={() => onPick({ url: g.full, mime: 'image/gif', name: 'tenor.gif', width: g.dims[0], height: g.dims[1] })}
              className="overflow-hidden rounded-lg bg-surface-2 transition-transform hover:scale-[1.03]"
            >
              <img src={g.preview} alt="GIF" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
          {items.length === 0 && <p className="col-span-2 py-8 text-center text-sm text-content-muted">No GIFs found.</p>}
        </div>
      )}
      <p className="border-t border-border py-1 text-center text-[10px] text-content-muted">Powered by Tenor</p>
    </div>
  );
}
