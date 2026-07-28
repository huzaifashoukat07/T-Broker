import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppSelector } from '../app/store';

/**
 * Admin-only guard. The API enforces this independently on every admin
 * endpoint; this just avoids showing a screen that would fail on load.
 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useAppSelector((s) => s.auth.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isAdmin) return <Navigate to="/trade" replace />;
  return <>{children}</>;
}
