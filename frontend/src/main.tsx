import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installSessionInterceptor } from './lib/session';
import './index.css';

// Wrap fetch/EventSource/WebSocket before any component can call them, so no
// individual call site can forget the session token.
installSessionInterceptor();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
