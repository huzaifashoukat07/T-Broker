import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Divider, IconButton, InputAdornment,
  Paper, Snackbar, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { ContentCopy, CheckCircle } from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../app/store';
import {
  clearError, clearReceipts, fetchTransactions, fetchWalletConfig, submitDeposit,
  type PayMethod,
} from '../features/wallet/walletSlice';
import MethodPicker from '../features/wallet/MethodPicker';
import { tokens } from '../theme/theme';

const MIN = 10;
const MAX = 50000;
const QUICK = [50, 100, 250, 500, 1000];

/** Which stored wallet backs each on-chain method. */
const WALLET_KEY: Partial<Record<PayMethod, string>> = {
  'usdt-bep20': 'bep20',
  'usdt-trc20': 'trc20',
};

export default function DepositPage() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const { wallets, promoPct, binanceQr, transactions, submitting, error, lastDeposit } =
    useAppSelector((s) => s.wallet);

  const [method, setMethod] = useState<PayMethod>('binance');
  const [amount, setAmount] = useState('100');
  const [promo, setPromo] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    dispatch(fetchWalletConfig());
    dispatch(fetchTransactions());
    return () => { dispatch(clearReceipts()); };
  }, [dispatch]);

  const pending = useMemo(
    () => transactions.filter((t) => t.type === 'deposit' && t.status === 'pending'),
    [transactions],
  );
  // The promo is first-deposit only, so only offer it to someone eligible.
  const eligibleForPromo = !user?.hasDeposited;

  const value = Number(amount);
  const valid = Number.isFinite(value) && value >= MIN && value <= MAX;
  const wallet = WALLET_KEY[method] ? wallets[WALLET_KEY[method]!] : null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch { /* clipboard blocked — the address is selectable anyway */ }
  };

  const submit = () => {
    if (!valid) return;
    dispatch(submitDeposit({ amount: value, method, promo: promo.trim() || undefined }));
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={800} gutterBottom>Deposit</Typography>

      {pending.length > 0 && (
        <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mb: 2 }}>
          {pending.length === 1
            ? `Your $${pending[0].amount.toFixed(2)} deposit is being confirmed.`
            : `${pending.length} deposits are being confirmed.`}{' '}
          Funds appear in your live balance once approved.
        </Alert>
      )}

      {lastDeposit && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => dispatch(clearReceipts())}>
          Request received for <b>${lastDeposit.amount.toFixed(2)}</b>
          {lastDeposit.bonus > 0 && <> plus a <b>${lastDeposit.bonus.toFixed(2)}</b> bonus</>}.
          Send the payment using the details below if you haven't already — it is credited after review.
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} alignItems="flex-start">
        <Box sx={{ flex: 1, width: '100%' }}>
          <Typography fontSize={11} fontWeight={800} color="text.secondary" sx={{ mb: 1 }}>
            PAYMENT METHOD
          </Typography>
          <MethodPicker value={method} onChange={setMethod} />
        </Box>

        <Paper sx={{ flex: 1, width: '100%', p: { xs: 2, sm: 2.5 } }}>
          <Typography fontSize={11} fontWeight={800} color="text.secondary" sx={{ mb: 1 }}>
            AMOUNT
          </Typography>
          <TextField
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            fullWidth
            error={!!amount && !valid}
            helperText={!amount || valid ? `Between $${MIN} and $${MAX.toLocaleString()}` : `Enter an amount between $${MIN} and $${MAX.toLocaleString()}`}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
            {QUICK.map((q) => (
              <Button key={q} size="small" variant="outlined" onClick={() => setAmount(String(q))}>
                ${q}
              </Button>
            ))}
          </Stack>

          {eligibleForPromo && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontSize={11} fontWeight={800} color="text.secondary" sx={{ mb: 1 }}>
                PROMO CODE <Box component="span" sx={{ color: tokens.gold }}>· {promoPct}% FIRST-DEPOSIT BONUS</Box>
              </Typography>
              <TextField
                value={promo}
                onChange={(e) => setPromo(e.target.value.toUpperCase())}
                placeholder="Enter code"
                fullWidth
                helperText="Optional. First deposit only. Bonus credit cannot be withdrawn, and is forfeited if you withdraw."
              />
            </>
          )}

          {wallet && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontSize={11} fontWeight={800} color="text.secondary">
                SEND {wallet.name.toUpperCase()} TO
              </Typography>
              <Alert severity="warning" sx={{ my: 1.5, fontSize: 12.5 }}>
                Send only over <b>{wallet.network}</b>. Funds sent on another network are lost.
              </Alert>
              {wallet.qr && (
                <Box
                  component="img" src={wallet.qr} alt={`${wallet.name} deposit QR code`}
                  sx={{ display: 'block', width: 168, height: 168, mx: 'auto', borderRadius: 2, mb: 1.5 }}
                />
              )}
              <TextField
                value={wallet.address} fullWidth size="small"
                InputProps={{
                  readOnly: true,
                  sx: { fontSize: 12.5 },
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title="Copy address">
                        <IconButton onClick={() => copy(wallet.address)} size="small">
                          <ContentCopy fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ),
                }}
              />
            </>
          )}

          {method === 'binance' && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontSize={11} fontWeight={800} color="text.secondary">
                SCAN WITH BINANCE PAY
              </Typography>
              {binanceQr ? (
                <Box
                  component="img" src={binanceQr} alt="Binance Pay QR code"
                  sx={{
                    display: 'block', width: 200, maxWidth: '100%', mx: 'auto',
                    my: 1.5, borderRadius: 2, bgcolor: '#fff', p: 1,
                  }}
                />
              ) : (
                <Alert severity="warning" sx={{ mt: 1.5, fontSize: 12.5 }}>
                  The Binance Pay QR image is missing. Contact support for payment details.
                </Alert>
              )}
              <Alert severity="info" sx={{ fontSize: 12.5 }}>
                Open Binance → Pay → Scan and pay the amount above. Keep the transaction ID
                in case support needs to match your payment.
              </Alert>
            </>
          )}

          <Button
            variant="contained" fullWidth size="large" sx={{ mt: 2.5 }}
            disabled={!valid || submitting}
            onClick={submit}
            startIcon={submitting ? <CircularProgress size={16} /> : <CheckCircle />}
          >
            {submitting ? 'Submitting…' : `Deposit $${valid ? value.toFixed(2) : '0.00'}`}
          </Button>
          <Typography fontSize={11.5} color="text.secondary" sx={{ mt: 1.5, textAlign: 'center' }}>
            Every deposit is reviewed by our team before it is credited.
          </Typography>
        </Paper>
      </Stack>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => dispatch(clearError())}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => dispatch(clearError())}>{error}</Alert>
      </Snackbar>
      <Snackbar open={copied} autoHideDuration={2000} onClose={() => setCopied(false)}
        message="Address copied" anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
