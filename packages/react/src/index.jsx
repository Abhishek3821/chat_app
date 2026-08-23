import { useEffect, useRef } from 'react';

/**
 * <ChatKonect /> — the whole product inside a React host, authenticated by the
 * host's own login.
 *
 * Deliberately a thin wrapper over the `embed.js` loader rather than a bundled
 * React implementation of the UI. A bundled component would have to survive the
 * host's React version, its Tailwind preflight, its global CSS and its state
 * management — in every host it ever lands in. The iframe sidesteps all of it,
 * and means there is exactly ONE implementation of the embed to keep correct.
 *
 * The loader is fetched from `host`, so the script and the framed app can never
 * be different versions of each other.
 */
export function ChatKonect({
  host,
  appId,
  getToken,
  token,
  tokenSeconds,
  onReady,
  onError,
  onConfig,
  className,
  style,
}) {
  const boxRef = useRef(null);
  const instanceRef = useRef(null);

  /* Callbacks live in a ref so a host passing inline arrow functions (the normal
     case) doesn't tear the iframe down and re-authenticate on every render. */
  const handlers = useRef({ getToken, token, onReady, onError, onConfig });
  handlers.current = { getToken, token, onReady, onError, onConfig };

  useEffect(() => {
    if (!host || !appId) return undefined;
    let cancelled = false;

    const loaderSrc = `${String(host).replace(/\/+$/, '')}/embed.js`;

    const mount = () => {
      if (cancelled || !boxRef.current || !window.ChatKonect) return;
      instanceRef.current = window.ChatKonect.mount({
        el: boxRef.current,
        appId,
        tokenSeconds,
        getToken: handlers.current.getToken
          ? (...args) => handlers.current.getToken(...args)
          : undefined,
        token: handlers.current.getToken ? undefined : handlers.current.token,
        onReady: (u) => handlers.current.onReady?.(u),
        onError: (e) => handlers.current.onError?.(e),
        onConfig: (c) => handlers.current.onConfig?.(c),
      });
    };

    if (window.ChatKonect) {
      mount();
    } else {
      /* Reuse an existing tag if another <ChatKonect /> already added one —
         appending a second copy would re-run the IIFE and replace the global
         while the first instance still holds a reference to it. */
      let script = document.querySelector(`script[src="${loaderSrc}"]`);
      if (!script) {
        script = document.createElement('script');
        script.src = loaderSrc;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', mount);
      script.addEventListener('error', () =>
        handlers.current.onError?.({
          code: 'loader_failed',
          message: `Could not load ${loaderSrc}. Check the host origin.`,
        })
      );
    }

    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
    // Only identity/config changes should remount — not callback identity.
  }, [host, appId, tokenSeconds]);

  return <div ref={boxRef} className={className} style={{ height: '100%', ...style }} />;
}

export default ChatKonect;
