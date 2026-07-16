import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import { registerServiceWorker } from './lib/push';

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
