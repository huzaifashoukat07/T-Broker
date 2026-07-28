import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
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

  // Debounced search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      dispatch(setSearch(term));
      dispatch(fetchUsers(term));
    }, 250);
    return () => clearTimeout(id);
  }, [term, dispatch]);

  return (
    <>
      <TextField
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search by name or email…"
        size="small"
        sx={{ mb: 2, maxWidth: 360 }}
      />

      {loadingUsers && users.length === 0 && <CircularProgress size={26} />}
      {!loadingUsers && users.length === 0 && (
        <Typography color="text.secondary">No accounts found.</Typography>
      )}

      {users.length > 0 && (
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
                {users.map((u) => {
                  const working = busy.includes(u.id);
                  return (
                    <TableRow key={u.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <span>{u.country || '🌐'}</span>
                          <Typography fontSize={13} fontWeight={700}>{u.name}</Typography>
                          {u.isAdmin && <Chip size="small" label="admin" color="primary" variant="outlined" />}
                          {u.blocked && <Chip size="small" label="blocked" color="error" variant="outlined" />}
                        </Stack>
                        <Typography fontSize={11.5} color="text.secondary">
                          {u.email} · joined {new Date(u.createdAt).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography fontSize={12} color="text.secondary">
                          {u.trades} trades · {u.wins}W/{u.losses}L
                        </Typography>
                        <Typography fontSize={12} color="text.secondary">
                          deposited {money(u.deposited)}
                          {u.pending > 0 && (
                            <Box component="span" sx={{ color: tokens.gold, fontWeight: 700 }}>
                              {' '}· {u.pending} pending
                            </Box>
                          )}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight={800}>{money(u.live)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography color="text.secondary">{money(u.demo)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.75} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                          <Button size="small" variant="outlined" disabled={working}
                            onClick={() => setAdjusting(u)}>
                            Balance
                          </Button>
                          <Button size="small" variant="outlined" disabled={working}
                            onClick={() => setNoticeFor(u)}>
                            Notice
                          </Button>
                          {!u.isAdmin && (
                            <Button
                              size="small"
                              variant="outlined"
                              color={u.blocked ? 'success' : 'error'}
                              disabled={working}
                              onClick={() => {
                                if (u.blocked || confirm(`Block ${u.name}? They will be signed out and unable to log in.`)) {
                                  dispatch(setBlocked({ userId: u.id, blocked: !u.blocked, search }));
                                }
                              }}
                            >
                              {u.blocked ? 'Unblock' : 'Block'}
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}

      <AdjustBalanceDialog user={adjusting} onClose={() => setAdjusting(null)} />
      <NoticeDialog user={noticeFor} onClose={() => setNoticeFor(null)} />
    </>
  );
}
