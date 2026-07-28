import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Divider, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { fetchUsers, setBlocked, setSearch, type AdminUser } from './adminSlice';
import AdjustBalanceDialog from './AdjustBalanceDialog';
import NoticeDialog from './NoticeDialog';
import { tokens } from '../../theme/theme';

const money = (n: number) => `$${n.toFixed(2)}`;

export default function UsersTab() {
  const dispatch = useAppDispatch();
  const { users, loadingUsers, busy, search } = useAppSelector((s) => s.admin);
  const [term, setTerm] = useState(search);
  const [adjusting, setAdjusting] = useState<AdminUser | null>(null);
  const [noticeFor, setNoticeFor] = useState<AdminUser | null>(null);
  const compact = useMediaQuery(useTheme().breakpoints.down('md'));

  // Debounced search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      dispatch(setSearch(term));
      dispatch(fetchUsers(term));
    }, 250);
    return () => clearTimeout(id);
  }, [term, dispatch]);

  const toggleBlock = (u: AdminUser) => {
    if (u.blocked || confirm(`Block ${u.name}? They will be signed out and unable to log in.`)) {
      dispatch(setBlocked({ userId: u.id, blocked: !u.blocked, search }));
    }
  };

  const identity = (u: AdminUser) => (
    <>
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        <span>{u.country || '🌐'}</span>
        <Typography fontSize={13.5} fontWeight={700}>{u.name}</Typography>
        {u.isAdmin && <Chip size="small" label="admin" color="primary" variant="outlined" />}
        {u.blocked && <Chip size="small" label="blocked" color="error" variant="outlined" />}
      </Stack>
      <Typography fontSize={11.5} color="text.secondary" sx={{ wordBreak: 'break-all' }}>
        {u.email} · joined {new Date(u.createdAt).toLocaleDateString()}
      </Typography>
    </>
  );

  const activity = (u: AdminUser) => (
    <Typography fontSize={12} color="text.secondary">
      {u.trades} trades · {u.wins}W/{u.losses}L · deposited {money(u.deposited)}
      {u.pending > 0 && (
        <Box component="span" sx={{ color: tokens.gold, fontWeight: 700 }}> · {u.pending} pending</Box>
      )}
    </Typography>
  );

  const actions = (u: AdminUser, fullWidth = false) => (
    <Stack direction="row" spacing={0.75} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
      <Button size="small" variant="outlined" fullWidth={fullWidth} sx={fullWidth ? { flex: 1 } : undefined}
        disabled={busy.includes(u.id)} onClick={() => setAdjusting(u)}>
        Balance
      </Button>
      <Button size="small" variant="outlined" fullWidth={fullWidth} sx={fullWidth ? { flex: 1 } : undefined}
        disabled={busy.includes(u.id)} onClick={() => setNoticeFor(u)}>
        Notice
      </Button>
      {!u.isAdmin && (
        <Button
          size="small" variant="outlined" color={u.blocked ? 'success' : 'error'}
          fullWidth={fullWidth} sx={fullWidth ? { flex: 1 } : undefined}
          disabled={busy.includes(u.id)} onClick={() => toggleBlock(u)}
        >
          {u.blocked ? 'Unblock' : 'Block'}
        </Button>
      )}
    </Stack>
  );

  return (
    <>
      <TextField
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search by name or email…"
        size="small"
        fullWidth
        sx={{ mb: 2, maxWidth: { xs: '100%', md: 360 } }}
      />

      {loadingUsers && users.length === 0 && <CircularProgress size={26} />}
      {!loadingUsers && users.length === 0 && (
        <Typography color="text.secondary">No accounts found.</Typography>
      )}

      {users.length > 0 && (compact ? (
        // One card per account on narrow screens: the five-column table needs
        // side-scrolling to reach the action buttons, which is unusable.
        <Stack spacing={1.5}>
          {users.map((u) => (
            <Paper key={u.id} sx={{ p: 2 }}>
              {identity(u)}
              <Box sx={{ mt: 1 }}>{activity(u)}</Box>
              <Stack direction="row" spacing={3} sx={{ mt: 1.5 }}>
                <Box>
                  <Typography fontSize={10.5} fontWeight={800} color="text.secondary">LIVE</Typography>
                  <Typography fontSize={16} fontWeight={800}>{money(u.live)}</Typography>
                </Box>
                <Box>
                  <Typography fontSize={10.5} fontWeight={800} color="text.secondary">DEMO</Typography>
                  <Typography fontSize={16} color="text.secondary">{money(u.demo)}</Typography>
                </Box>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              {actions(u, true)}
            </Paper>
          ))}
        </Stack>
      ) : (
        <Paper>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Account</TableCell>
                  <TableCell>Activity</TableCell>
                  <TableCell align="right">Live</TableCell>
                  <TableCell align="right">Demo</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell>{identity(u)}</TableCell>
                    <TableCell>{activity(u)}</TableCell>
                    <TableCell align="right">
                      <Typography fontWeight={800}>{money(u.live)}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography color="text.secondary">{money(u.demo)}</Typography>
                    </TableCell>
                    <TableCell align="right">{actions(u)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      ))}

      <AdjustBalanceDialog user={adjusting} onClose={() => setAdjusting(null)} />
      <NoticeDialog user={noticeFor} onClose={() => setNoticeFor(null)} />
    </>
  );
}
