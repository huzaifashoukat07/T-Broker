import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAppDispatch, useAppSelector } from './app/store';
import { loadSession } from './features/auth/authSlice';
import RequireAuth from './components/RequireAuth';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import TradePage from './pages/TradePage';
import WalletPage from './pages/WalletPage';
import PlaceholderPage from './pages/PlaceholderPage';

const TITLES: Record<string, string> = {
  '/login': 'Log in',
  '/trade': 'Trade',
  '/wallet': 'Transactions',
  '/top': 'Top traders',
  '/deposit': 'Deposit',
  '/withdraw': 'Withdrawal',
  '/help': 'How to trade',
  '/admin': 'Admin',
};

export default function App() {
  const dispatch = useAppDispatch();
  const ready = useAppSelector((s) => s.auth.ready);
  const { pathname } = useLocation();

  useEffect(() => {
    dispatch(loadSession());
  }, [dispatch]);

  useEffect(() => {
    document.title = `${TITLES[pathname] ?? 'Trade'} — NovaTrade`;
  }, [pathname]);

  if (!ready) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100dvh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Every route below renders a full screen of its own — no page is drawn as
  // an overlay on top of the trading chart.
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/trade" element={<TradePage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/top" element={<PlaceholderPage title="Top traders" />} />
        <Route path="/deposit" element={<PlaceholderPage title="Deposit" />} />
        <Route path="/withdraw" element={<PlaceholderPage title="Withdrawal" />} />
        <Route path="/help" element={<PlaceholderPage title="How to trade" />} />
        <Route path="/admin" element={<PlaceholderPage title="Admin panel" />} />
      </Route>
      <Route path="*" element={<Navigate to="/trade" replace />} />
    </Routes>
  );
}
