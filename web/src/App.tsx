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
  '/app/trade': 'Trade',
  '/app/wallet': 'Transactions',
  '/app/top': 'Top traders',
  '/app/deposit': 'Deposit',
  '/app/withdraw': 'Withdrawal',
  '/app/help': 'How to trade',
  '/app/admin': 'Admin',
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

  // Sign-in owns the real /login URL. Screens still being ported live under
  // /app/* until they replace their counterparts on the original frontend.
  // Every route renders a full screen of its own — nothing is drawn as an
  // overlay on top of the trading chart.
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app/login" element={<Navigate to="/login" replace />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/app/trade" element={<TradePage />} />
        <Route path="/app/wallet" element={<WalletPage />} />
        <Route path="/app/top" element={<PlaceholderPage title="Top traders" />} />
        <Route path="/app/deposit" element={<PlaceholderPage title="Deposit" />} />
        <Route path="/app/withdraw" element={<PlaceholderPage title="Withdrawal" />} />
        <Route path="/app/help" element={<PlaceholderPage title="How to trade" />} />
        <Route path="/app/admin" element={<PlaceholderPage title="Admin panel" />} />
      </Route>
      <Route path="/app" element={<Navigate to="/app/trade" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
