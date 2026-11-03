import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { CelebrationProvider } from './components/Celebration';
import { ToastProvider } from './components/Toast';
import { ApiError } from './lib/api';
import { registerSW } from './lib/push';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
});

registerSW(); // also in dev so push and local notifications can be tested

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <CelebrationProvider>
            <App />
          </CelebrationProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
