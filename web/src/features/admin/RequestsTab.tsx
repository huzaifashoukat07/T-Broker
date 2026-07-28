import {
  Alert, Box, Button, Chip, CircularProgress, Divider, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { resolveRequest, type AdminRequest } from './adminSlice';
import { tokens } from '../../theme/theme';

const money = (n: number) => `$${n.toFixed(2)}`;
const destinationOf = (r: AdminRequest) =>
  r.binanceId ? `Binance ID ${r.binanceId}` : r.address || r.method || '—';

function TypeChip({ type }: { type: AdminRequest['type'] }) {
  const colour = type === 'deposit' ? tokens.up : tokens.gold;
  return (
    <Chip
      size="small" label={type} variant="outlined"
      sx={{ textTransform: 'capitalize', color: colour, borderColor: colour }}
    />
  );
}

/** Pending deposits and withdrawals, approved or rejected one row at a time. */
export default function RequestsTab() {
  const dispatch = useAppDispatch();
  const { requests, loadingRequests, busy } = useAppSelector((s) => s.admin);
  const compact = useMediaQuery(useTheme().breakpoints.down('md'));

  if (loadingRequests && requests.length === 0) return <CircularProgress size={26} />;
  if (requests.length === 0) {
    return <Typography color="text.secondary">No pending requests.</Typography>;
  }

  const actions = (r: AdminRequest, fullWidth = false) => (
    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ width: fullWidth ? '100%' : 'auto' }}>
      <Button
        size="small" variant="contained" color="success" fullWidth={fullWidth}
        disabled={busy.includes(r.id)}
        onClick={() => dispatch(resolveRequest({ txId: r.id, action: 'approve' }))}
      >
        Approve
      </Button>
      <Button
        size="small" variant="outlined" color="error" fullWidth={fullWidth}
        disabled={busy.includes(r.id)}
        onClick={() => dispatch(resolveRequest({ txId: r.id, action: 'reject' }))}
      >
        Reject
      </Button>
    </Stack>
  );

  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        Deposits: confirm the money arrived in your wallet <b>before</b> crediting.
        Withdrawals: send the payout first, then mark it paid.
      </Alert>

      {/* A six-column table cannot fit a phone, and side-scrolling to reach
          Approve is unusable — so narrow screens get one card per request. */}
      {compact ? (
        <Stack spacing={1.5}>
          {requests.map((r) => (
            <Paper key={r.id} sx={{ p: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontSize={14} fontWeight={700} noWrap>{r.name}</Typography>
                  <Typography fontSize={12} color="text.secondary" noWrap>{r.email}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right', flex: 'none' }}>
                  <Typography fontSize={18} fontWeight={800}>{money(r.amount)}</Typography>
                  <TypeChip type={r.type} />
                </Box>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              <Typography fontSize={11} fontWeight={800} color="text.secondary">DESTINATION</Typography>
              <Typography fontSize={12.5} sx={{ wordBreak: 'break-all', mb: 1 }}>
                {destinationOf(r)}
              </Typography>
              <Typography fontSize={11.5} color="text.secondary" sx={{ mb: 1.5 }}>
                {new Date(r.time).toLocaleString()}
              </Typography>
              {actions(r, true)}
            </Paper>
          ))}
        </Stack>
      ) : (
        <Paper>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Destination</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Requested</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Typography fontSize={13} fontWeight={700}>{r.name}</Typography>
                      <Typography fontSize={11.5} color="text.secondary">{r.email}</Typography>
                    </TableCell>
                    <TableCell><TypeChip type={r.type} /></TableCell>
                    <TableCell>
                      <Typography fontSize={12} sx={{ wordBreak: 'break-all', maxWidth: 260 }}>
                        {destinationOf(r)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight={800}>{money(r.amount)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography fontSize={12} color="text.secondary">
                        {new Date(r.time).toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{actions(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}
    </>
  );
}
