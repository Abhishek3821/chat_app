import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import { registerServiceWorker } from './lib/push';
import { initAudioUnlock } from './lib/sounds';
import { initUnreadBadge } from './lib/notify';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Register the push service worker in the background (no-op where unsupported).
// Subscribing still requires an explicit user opt-in from Settings → Notifications.
registerServiceWorker();

// Browsers refuse to play audio until the page has been interacted with — arm
// the notification/ringtone context on the user's first click or keypress.
initAudioUnlock();

// Mirror the unread total into the tab title and OS app badge.
initUnreadBadge();
