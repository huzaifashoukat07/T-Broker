import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import type { PayMethod } from './walletSlice';
import { tokens } from '../../theme/theme';

interface Option {
  id: PayMethod | 'card' | 'bank';
  label: string;
  sub: string;
  icon: string;
  soon?: boolean;
}

const OPTIONS: Option[] = [
  { id: 'binance', label: 'Binance Pay', sub: 'Instant · no network fee', icon: '🟡' },
  { id: 'usdt-bep20', label: 'USDT — BEP20', sub: 'BNB Smart Chain', icon: '💠' },
  { id: 'usdt-trc20', label: 'USDT — TRC20', sub: 'Tron network', icon: '🔴' },
  { id: 'card', label: 'Credit / debit card', sub: 'Visa · Mastercard', icon: '💳', soon: true },
  { id: 'bank', label: 'Bank transfer', sub: 'Local bank', icon: '🏦', soon: true },
];

/** Payment-method tiles shared by the deposit and withdrawal screens. */
export default function MethodPicker({
  value, onChange, hideSoon = false,
}: {
  value: PayMethod;
  onChange: (m: PayMethod) => void;
  /** withdrawals have no card/bank option at all, not even as "coming soon" */
  hideSoon?: boolean;
}) {
  const options = hideSoon ? OPTIONS.filter((o) => !o.soon) : OPTIONS;

  return (
    <Stack spacing={1.25}>
      {options.map((o) => {
        const selected = !o.soon && value === o.id;
        return (
          <Paper
            key={o.id}
            onClick={() => { if (!o.soon) onChange(o.id as PayMethod); }}
            sx={{
              p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5,
              cursor: o.soon ? 'default' : 'pointer',
              opacity: o.soon ? 0.55 : 1,
              borderColor: selected ? tokens.accent : tokens.border,
              bgcolor: selected ? 'rgba(47,124,246,.10)' : undefined,
              transition: 'border-color .15s, background-color .15s',
              '&:hover': o.soon ? undefined : { borderColor: tokens.accent },
            }}
          >
            <Box sx={{ fontSize: 22, lineHeight: 1 }}>{o.icon}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontSize={13.5} fontWeight={700}>{o.label}</Typography>
              <Typography fontSize={11.5} color="text.secondary">{o.sub}</Typography>
            </Box>
            {o.soon && <Chip size="small" label="Coming soon" variant="outlined" />}
            {selected && <Chip size="small" label="Selected" color="primary" />}
          </Paper>
        );
      })}
    </Stack>
  );
}
