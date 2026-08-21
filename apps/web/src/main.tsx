import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { installLogCapture } from './lib/diagnostics.ts';
import './styles/tokens.css';
import './styles/app.css';

// Before React renders, so a crash during the first paint is still in the buffer when
// someone reports it. A feedback ticket's whole value is the log attached to it.
installLogCapture();

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
