import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { resolveRequest } from './adminSlice';
import { tokens } from '../../theme/theme';

const money = (n: number) => `$${n.toFixed(2)}`;

/** Pending deposits and withdrawals, approved or rejected one row at a time. */
export default function RequestsTab() {
  const dispatch = useAppDispatch();
  const { requests, loadingRequests, busy } = useAppSelector((s) => s.admin);

  if (loadingRequests && requests.length === 0) return <CircularProgress size={26} />;

  if (requests.length === 0) {
    return <Typography color="text.secondary">No pending requests.</Typography>;
  }

  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        Deposits: confirm the money arrived in your wallet <b>before</b> crediting.
        Withdrawals: send the payout first, then mark it paid.
      </Alert>
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
              {requests.map((r) => {
                const working = busy.includes(r.id);
                const dest = r.binanceId ? `Binance ID ${r.binanceId}` : r.address || r.method || '—';
                return (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Typography fontSize={13} fontWeight={700}>{r.name}</Typography>
                      <Typography fontSize={11.5} color="text.secondary">{r.email}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.type}
                        sx={{
                          textTransform: 'capitalize',
                          color: r.type === 'deposit' ? tokens.up : tokens.gold,
                          borderColor: r.type === 'deposit' ? tokens.up : tokens.gold,
                        }}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography fontSize={12} sx={{ wordBreak: 'break-all', maxWidth: 260 }}>
                        {dest}
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
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small" variant="contained" color="success" disabled={working}
                          onClick={() => dispatch(resolveRequest({ txId: r.id, action: 'approve' }))}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small" variant="outlined" color="error" disabled={working}
                          onClick={() => dispatch(resolveRequest({ txId: r.id, action: 'reject' }))}
                        >
                          Reject
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </>
  );
}
