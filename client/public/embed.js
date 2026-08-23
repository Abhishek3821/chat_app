/**
 * ChatKonect drop-in loader.
 *
 * The whole product, inside a host application's page, authenticated by the
 * host's own login. The host supplies one thing — a user token, which its
 * backend already mints through the platform API — and nothing else: no socket
 * URL, no API base, no TURN relay, no reimplemented UI.
 *
 *   <div id="chat" style="height:600px"></div>
 *   <script src="https://chat.example.com/embed.js"></script>
 *   <script>
 *     const chat = ChatKonect.mount({
 *       el: '#chat',
 *       appId: 'app_7f3c9a2b4d1e',
 *       // Called on mount AND again before the token expires. Point it at YOUR
 *       // endpoint, which mints via POST /api/v1/platform/tokens behind your own
 *       // session. The app SECRET must never come near this file.
 *       getToken: () => fetch('/my-app/chat-token').then(r => r.json()).then(d => d.token),
 *       onReady: (user) => console.log('chat ready', user),
 *       onError: (err) => console.error(err.code, err.message),
 *     });
 *
 *     chat.navigate('/calls');   // drive the embedded UI
 *     chat.destroy();            // remove it
 *   </script>
 *
 * Why an iframe rather than a bundled component: it isolates CSS and JavaScript
 * completely, so the embed cannot collide with the host's React version, Tailwind
 * preflight, global styles or state — and it works the same in React, Vue,
 * Angular, Rails or a plain HTML page. A published npm component would have to
 * fight all of that in every host it lands in.
 */
(function () {
  'use strict';

  var EMBED = 'chatkonect-embed';
  var HOST = 'chatkonect-host';

  /* Where this script was served from IS the ChatKonect frontend origin, so the
     host never has to configure it — and it cannot be pointed somewhere else by
     a typo. `currentScript` is read immediately because it is null by the time
     any callback runs. */
  var selfScript = document.currentScript;
  function originOfSelf() {
    try {
      return new URL(selfScript.src).origin;
    } catch (e) {
      return window.location.origin;
    }
  }
  var CK_ORIGIN = originOfSelf();

  function resolveEl(el) {
    if (!el) return null;
    return typeof el === 'string' ? document.querySelector(el) : el;
  }

  function mount(options) {
    var opts = options || {};
    var container = resolveEl(opts.el);
    if (!container) throw new Error('ChatKonect.mount: `el` did not resolve to an element.');
    if (!opts.appId) throw new Error('ChatKonect.mount: `appId` is required.');
    if (!opts.getToken && !opts.token) {
      throw new Error('ChatKonect.mount: supply `getToken` (recommended) or `token`.');
    }

    var onReady = opts.onReady || function () {};
    var onError = opts.onError || function () {};
    var onConfig = opts.onConfig || function () {};
    var destroyed = false;

    var src =
      CK_ORIGIN +
      '/embed?appId=' +
      encodeURIComponent(opts.appId) +
      /* The embed verifies every postMessage against this exact origin, so it can
         tell OUR host page from any other frame that happens to load it. */
      '&parentOrigin=' +
      encodeURIComponent(window.location.origin) +
      (opts.tokenSeconds ? '&tokenSeconds=' + encodeURIComponent(opts.tokenSeconds) : '') +
      (opts.theme ? '&theme=' + encodeURIComponent(opts.theme) : '');

    var iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.title = 'ChatKonect';
    iframe.style.cssText = 'border:0;width:100%;height:100%;display:block;';
    /* Calls and meetings need real device access, and screen share needs
       display-capture. Without these the UI mounts and every call fails at
       getUserMedia with a permissions error that looks like a bug in the app. */
    iframe.allow = [
      'camera',
      'microphone',
      'display-capture',
      'autoplay',
      'clipboard-write',
      'fullscreen',
    ].join('; ');
    iframe.setAttribute('allowfullscreen', 'true');

    /* Deliver a token to the frame. Never '*' as the target origin — that would
       hand a live session to whatever document currently occupies the iframe. */
    function send(msg) {
      if (destroyed || !iframe.contentWindow) return;
      iframe.contentWindow.postMessage(Object.assign({ source: HOST }, msg), CK_ORIGIN);
    }

    function supplyToken() {
      var got;
      try {
        got = opts.getToken ? opts.getToken() : opts.token;
      } catch (err) {
        onError({ code: 'get_token_threw', message: err && err.message });
        return;
      }
      Promise.resolve(got)
        .then(function (token) {
          if (!token) {
            onError({ code: 'no_token', message: 'getToken resolved without a token.' });
            return;
          }
          send({ type: 'auth', token: token });
        })
        .catch(function (err) {
          onError({ code: 'get_token_failed', message: (err && err.message) || 'getToken rejected.' });
        });
    }

    function onMessage(event) {
      // Only the frame we created, on the origin we loaded it from.
      if (event.origin !== CK_ORIGIN) return;
      if (!event.data || event.data.source !== EMBED) return;
      if (event.source !== iframe.contentWindow) return;

      switch (event.data.type) {
        case 'awaiting-token':
          supplyToken();
          break;
        case 'token-expiring':
          // Re-mint well before expiry so the session never visibly drops.
          supplyToken();
          break;
        case 'config':
          onConfig(event.data);
          break;
        case 'ready':
          onReady(event.data.user);
          break;
        case 'error':
          onError({ code: event.data.code, message: event.data.message });
          break;
        default:
          break;
      }
    }

    window.addEventListener('message', onMessage);
    container.appendChild(iframe);

    return {
      /** Drive the embedded UI, e.g. '/calls', '/meetings', '/settings'. */
      navigate: function (to) {
        send({ type: 'navigate', to: to });
      },
      /** Push a fresh token immediately (e.g. after your own re-login). */
      refreshToken: function () {
        supplyToken();
      },
      destroy: function () {
        destroyed = true;
        window.removeEventListener('message', onMessage);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      },
      iframe: iframe,
    };
  }

  window.ChatKonect = { mount: mount, origin: CK_ORIGIN, version: '1' };
})();
