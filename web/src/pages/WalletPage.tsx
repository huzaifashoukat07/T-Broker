import { useEffect, useState } from 'react';
import {
  Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '../app/api';
import { useAppSelector } from '../app/store';

interface Tx {
  id: string;
  time: number;
  type: 'deposit' | 'withdrawal';
  amount: number;
  method?: string;
  status: 'pending' | 'completed' | 'rejected';
}

const STATUS_COLOR = {
  completed: 'success',
  pending: 'warning',
  rejected: 'error',
} as const;

const money = (n: number) => `$${n.toFixed(2)}`;

/** A full screen, not an overlay: navigating here leaves the trading view. */
export default function WalletPage() {
  const balances = useAppSelector((s) => s.auth.user?.balances);
  const [rows, setRows] = useState<Tx[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ transactions: Tx[] }>('/api/transactions')
      .then((d) => setRows(d.transactions))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 900 }}>
      <Typography variant="h5" fontWeight={800} gutterBottom>Wallet</Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Paper sx={{ p: 2, minWidth: 160 }}>
          <Typography fontSize={11} fontWeight={800} color="text.secondary">LIVE BALANCE</Typography>
          <Typography fontSize={22} fontWeight={800}>{money(balances?.live ?? 0)}</Typography>
        </Paper>
        <Paper sx={{ p: 2, minWidth: 160 }}>
          <Typography fontSize={11} fontWeight={800} color="text.secondary">DEMO BALANCE</Typography>
          <Typography fontSize={22} fontWeight={800}>{money(balances?.demo ?? 0)}</Typography>
        </Paper>
        {!!balances?.bonus && (
          <Paper sx={{ p: 2, minWidth: 160 }}>
            <Typography fontSize={11} fontWeight={800} color="text.secondary">BONUS</Typography>
            <Typography fontSize={22} fontWeight={800} color="warning.main">{money(balances.bonus)}</Typography>
          </Paper>
        )}
      </Stack>

      <Typography fontWeight={700} sx={{ mb: 1.5 }}>Transactions</Typography>
      {error && <Typography color="error">{error}</Typography>}
      {!rows && !error && <CircularProgress size={24} />}
      {rows && rows.length === 0 && (
        <Typography color="text.secondary">No transactions yet.</Typography>
      )}
      {rows && rows.length > 0 && (
        <Paper>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Method</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{new Date(t.time).toLocaleString()}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{t.type}</TableCell>
                  <TableCell>{t.method ?? '—'}</TableCell>
                  <TableCell align="right">{money(t.amount)}</TableCell>
                  <TableCell align="right">
                    <Chip size="small" label={t.status} color={STATUS_COLOR[t.status]} variant="outlined" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}
