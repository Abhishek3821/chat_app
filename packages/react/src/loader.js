const loading = new Map();

export async function loadChatKonect(host) {
  const url = new URL(host);
  if (!/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    return Promise.reject(new Error('host must be the ChatKonect HTTP(S) origin.'));
  }
  const origin = url.origin;
  const registered = window.ChatKonectLoaders?.[origin];
  if (registered) return Promise.resolve(registered);
  if (window.ChatKonect?.origin === origin) return Promise.resolve(window.ChatKonect);
  if (loading.has(origin)) return loading.get(origin);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${origin}/embed.js`;
    script.async = true;
    script.onload = () => {
      const loader = window.ChatKonectLoaders?.[origin] || (window.ChatKonect?.origin === origin && window.ChatKonect);
      if (loader) resolve(loader);
      else { loading.delete(origin); script.remove(); reject(new Error('The ChatKonect loader did not register.')); }
    };
    script.onerror = () => { loading.delete(origin); script.remove(); reject(new Error(`Could not load ${script.src}.`)); };
    document.head.appendChild(script);
  });
  loading.set(origin, promise);
  return promise;
}
