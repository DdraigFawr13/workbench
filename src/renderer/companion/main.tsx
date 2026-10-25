// Phone companion page: served by Workbench's companion server (src/main/companion/) to a
// paired phone; it has no electronAPI and talks to the server over HTTP (./api.ts)
import '../../shared/i18n';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { CompanionApp } from './CompanionApp';
import '../styles/globals.css';

// Follow the phone's light or dark setting
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', darkQuery.matches);
applyTheme();
darkQuery.addEventListener('change', applyTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CompanionApp />
  </React.StrictMode>
);
