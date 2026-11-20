import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import './styles.css';
import { App } from './App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './Auth';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 0 } } });

async function bootstrap() {
  // localhost and 127.0.0.1 are different origins/sites. Match the local API
  // hostname before mounting: this preserves exact CORS and refresh cookies.
  const apiHostname = new URL(import.meta.env.VITE_API_URL || 'http://localhost:3000/api', window.location.origin).hostname;
  const loopbackHosts = ['localhost', '127.0.0.1'];
  if (loopbackHosts.includes(window.location.hostname) && loopbackHosts.includes(apiHostname) && window.location.hostname !== apiHostname) {
    const canonical = new URL(window.location.href);
    canonical.hostname = apiHostname;
    window.location.replace(canonical.href);
    return;
  }
  // Retire the previous offline CRUD worker: protected requests must reach the real API.
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter(registration => registration.active?.scriptURL.endsWith('/mockServiceWorker.js')).map(registration => registration.unregister()));
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><Theme appearance="light" accentColor="tomato" grayColor="sand" radius="small" scaling="100%"><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></Theme></QueryClientProvider></React.StrictMode>,
);
}
void bootstrap();
