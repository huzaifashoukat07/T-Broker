import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Divider, InputAdornment, Paper, Snackbar,
  Stack, TextField, Typography,
} from '@mui/material';
import { useAppDispatch, useAppSelector } from '../app/store';
import {
  clearError, clearReceipts, fetchTransactions, fetchWalletConfig, submitWithdrawal,
  type PayMethod,
} from '../features/wallet/walletSlice';
import MethodPicker from '../features/wallet/MethodPicker';
import { tokens } from '../theme/theme';

const PER_DAY = 2;

// Mirrors the server's validation so mistakes are caught before submitting.
const ADDRESS_RULES: Record<string, { re: RegExp; hint: string; label: string }> = {
  'usdt-bep20': {
    re: /^0x[0-9a-fA-F]{40}$/,
    hint: 'Starts with 0x, 42 characters',
    label: 'BEP20 address',
  },
  'usdt-trc20': {
    re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    hint: 'Starts with T, 34 characters',
    label: 'TRC20 address',
  },
};

const money = (n: number) => `$${n.toFixed(2)}`;

export default function WithdrawPage() {
  const dispatch = useAppDispatch();
  const balances = useAppSelector((s) => s.auth.user?.balances);
  const { transactions, submitting, error, lastWithdrawal } = useAppSelector((s) => s.wallet);

  const [method, setMethod] = useState<PayMethod>('binance');
  const [amount, setAmount] = useState('');
  const [binanceId, setBinanceId] = useState('');
  const [address, setAddress] = useState('');

  useEffect(() => {
    dispatch(fetchWalletConfig());
    dispatch(fetchTransactions());
    return () => { dispatch(clearReceipts()); };
  }, [dispatch]);

  const bonus = balances?.bonus ?? 0;
  const live = balances?.live ?? 0;
  // Bonus credit is not withdrawable, so it is excluded from the maximum.
  const withdrawable = Math.max(0, Math.round((live - bonus) * 100) / 100);

  const { hasPending, usedToday } = useMemo(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const w = transactions.filter((t) => t.type === 'withdrawal');
    return {
      hasPending: w.some((t) => t.status === 'pending'),
      usedToday: w.filter((t) => t.status !== 'rejected' && t.time >= dayAgo).length,
    };
  }, [transactions]);

  const value = Number(amount);
  const rule = ADDRESS_RULES[method];
  const amountValid = Number.isFinite(value) && value > 0 && value <= withdrawable;
  const destValid = method === 'binance'
    ? /^[0-9]{6,15}$/.test(binanceId.trim())
    : !!rule && rule.re.test(address.trim());
  const limitReached = usedToday >= PER_DAY;
  const canSubmit = amountValid && destValid && !hasPending && !limitReached && !submitting;

  const submit = () => {
    if (!canSubmit) return;
    dispatch(submitWithdrawal({
      amount: value,
      method,
      ...(method === 'binance' ? { binanceId: binanceId.trim() } : { address: address.trim() }),
    }));
    setAmount('');
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={800} gutterBottom>Withdrawal</Typography>

      {lastWithdrawal && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => dispatch(clearReceipts())}>
          Withdrawal of <b>{money(lastWithdrawal.amount)}</b> requested — it is paid out after review.
          {lastWithdrawal.bonusForfeited > 0 && (
            <> Your {money(lastWithdrawal.bonusForfeited)} bonus was forfeited, as the bonus terms state.</>
          )}
        </Alert>
      )}
      {hasPending && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You already have a withdrawal in progress. You can request another once it completes.
        </Alert>
      )}
      {limitReached && !hasPending && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You have used both withdrawals for the last 24 hours. Please try again later.
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} alignItems="flex-start">
        <Box sx={{ flex: 1, width: '100%' }}>
          <Typography fontSize={11} fontWeight={800} color="text.secondary" sx={{ mb: 1 }}>
            WITHDRAW TO
          </Typography>
          <MethodPicker value={method} onChange={setMethod} hideSoon />

          <Paper sx={{ p: 2, mt: 2 }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography fontSize={12.5} color="text.secondary">Live balance</Typography>
              <Typography fontSize={12.5} fontWeight={700}>{money(live)}</Typography>
            </Stack>
            {bonus > 0 && (
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.75 }}>
                <Typography fontSize={12.5} color="text.secondary">Bonus (not withdrawable)</Typography>
                <Typography fontSize={12.5} fontWeight={700} sx={{ color: tokens.gold }}>
                  −{money(bonus)}
                </Typography>
              </Stack>
            )}
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" justifyContent="space-between">
              <Typography fontSize={13} fontWeight={700}>Available</Typography>
              <Typography fontSize={15} fontWeight={800} sx={{ color: tokens.up }}>
                {money(withdrawable)}
              </Typography>
            </Stack>
            <Typography fontSize={11.5} color="text.secondary" sx={{ mt: 1 }}>
              {Math.max(0, PER_DAY - usedToday)} of {PER_DAY} withdrawals left in the next 24 hours
            </Typography>
          </Paper>
        </Box>

        <Paper sx={{ flex: 1, width: '100%', p: { xs: 2, sm: 2.5 } }}>
          <Typography fontSize={11} fontWeight={800} color="text.secondary" sx={{ mb: 1 }}>
            AMOUNT
          </Typography>
          <TextField
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            fullWidth
            placeholder="0.00"
            error={!!amount && !amountValid}
            helperText={
              !amount ? `Up to ${money(withdrawable)}`
              : amountValid ? `You will receive ${money(value)}`
              : value > withdrawable ? `More than your available ${money(withdrawable)}`
              : 'Enter a valid amount'
            }
            InputProps={{
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
              endAdornment: (
                <InputAdornment position="end">
                  <Button size="small" onClick={() => setAmount(String(withdrawable))}>MAX</Button>
                </InputAdornment>
              ),
            }}
          />

          <Divider sx={{ my: 2 }} />

          {method === 'binance' ? (
            <TextField
              label="Binance ID" value={binanceId} fullWidth
              onChange={(e) => setBinanceId(e.target.value.replace(/\D/g, ''))}
              error={!!binanceId && !destValid}
              helperText="The numeric ID from your Binance profile"
            />
          ) : (
            <TextField
              label={rule?.label} value={address} fullWidth
              onChange={(e) => setAddress(e.target.value.trim())}
              error={!!address && !destValid}
              helperText={rule?.hint}
              InputProps={{ sx: { fontSize: 13 } }}
            />
          )}

          {bonus > 0 && (
            <Alert severity="warning" sx={{ mt: 2, fontSize: 12.5 }}>
              Withdrawing forfeits your entire <b>{money(bonus)}</b> bonus, whatever the amount.
            </Alert>
          )}

          <Button
            variant="contained" fullWidth size="large" sx={{ mt: 2.5 }}
            disabled={!canSubmit} onClick={submit}
            startIcon={submitting ? <CircularProgress size={16} /> : undefined}
          >
            {submitting ? 'Submitting…' : 'Request withdrawal'}
          </Button>
          <Typography fontSize={11.5} color="text.secondary" sx={{ mt: 1.5, textAlign: 'center' }}>
            Withdrawals are reviewed and paid out by our team.
          </Typography>
        </Paper>
      </Stack>

      <Snackbar open={!!error} autoHideDuration={7000} onClose={() => dispatch(clearError())}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => dispatch(clearError())}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
