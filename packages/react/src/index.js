import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { loadChatKonect } from './loader.js';

// No JSX or shared UI dependencies: works with ordinary React bundlers and SSR.
export const ChatKonect = forwardRef(function ChatKonect({
  host, appId, getToken, token, tokenSeconds, theme, initialPath, identityKey,
  onReady, onError, onConfig, onLogout, onNavigate, className, style,
}, ref) {
  const box = useRef(null);
  const instance = useRef(null);
  const handlers = useRef(null);
  handlers.current = { getToken, token, onReady, onError, onConfig, onLogout, onNavigate };
  useImperativeHandle(ref, () => ({
    navigate: (to) => instance.current?.navigate(to),
    refreshToken: () => instance.current?.refreshToken(),
    destroy: () => instance.current?.destroy(),
  }), []);

  useEffect(() => {
    let cancelled = false;
    if (!host || !appId) {
      handlers.current.onError?.({ code: 'invalid_config', message: 'host and appId are required.' });
      return undefined;
    }
    loadChatKonect(host).then((loader) => {
      if (cancelled || !box.current) return;
      instance.current = loader.mount({
        el: box.current, appId, tokenSeconds, theme, initialPath,
        getToken: () => handlers.current.getToken ? handlers.current.getToken() : handlers.current.token,
        onReady: (u) => handlers.current.onReady?.(u),
        onError: (e) => handlers.current.onError?.(e),
        onConfig: (c) => handlers.current.onConfig?.(c),
        onLogout: () => handlers.current.onLogout?.(),
        onNavigate: (to) => handlers.current.onNavigate?.(to),
      });
    }).catch((error) => {
      if (!cancelled) handlers.current.onError?.({ code: 'loader_failed', message: error.message });
    });
    return () => { cancelled = true; instance.current?.destroy(); instance.current = null; };
  }, [host, appId, tokenSeconds, theme, initialPath, identityKey]);

  return createElement('div', { ref: box, className, style: { height: '100%', ...style } });
});

export default ChatKonect;
