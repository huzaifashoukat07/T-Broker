import { useEffect, useState } from 'react';
import { Alert, Badge, Box, Snackbar, Tab, Tabs, Typography } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../app/store';
import { clearError, fetchRequests, fetchSummary, fetchUsers } from '../features/admin/adminSlice';
import { useAdminLive } from '../app/useAdminLive';
import RequestsTab from '../features/admin/RequestsTab';
import UsersTab from '../features/admin/UsersTab';

/**
 * Admin screen: pending requests and account management. Counts stay live via
 * the server's admin_refresh push, so a new deposit shows up without a reload.
 */
export default function AdminPage() {
  const dispatch = useAppDispatch();
  const { summary, error, search } = useAppSelector((s) => s.admin);
  const [tab, setTab] = useState<'requests' | 'users'>('requests');

  useEffect(() => {
    dispatch(fetchSummary());
    dispatch(fetchRequests());
    dispatch(fetchUsers(search));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  useAdminLive(search);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h5" fontWeight={800} gutterBottom>Admin panel</Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5 }}>
        <Tab
          value="requests"
          label={<Badge badgeContent={summary.requests} color="warning" sx={{ pr: 1.5 }}>Requests</Badge>}
        />
        <Tab
          value="users"
          label={<Badge badgeContent={summary.users} color="primary" max={9999} sx={{ pr: 2.5 }}>Users</Badge>}
        />
      </Tabs>

      {tab === 'requests' ? <RequestsTab /> : <UsersTab />}

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => dispatch(clearError())}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => dispatch(clearError())}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
