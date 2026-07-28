import { useEffect, useState } from 'react';
import {
  Button, Dialog, useMediaQuery, useTheme, DialogActions, DialogContent, DialogTitle, MenuItem, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { adjustBalance, type AdminUser } from './adminSlice';

/** Credit or debit a single account, with the resulting balance shown first. */
export default function AdjustBalanceDialog({
  user, onClose,
}: { user: AdminUser | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const search = useAppSelector((s) => s.admin.search);
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [account, setAccount] = useState<'live' | 'demo'>('live');
  const [amount, setAmount] = useState('100');

  useEffect(() => {
    if (user) { setDirection('credit'); setAccount('live'); setAmount('100'); }
  }, [user]);

  if (!user) return null;

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;
  const current = account === 'live' ? user.live : user.demo;
  const next = direction === 'credit' ? current + value : current - value;
  const overdraft = valid && next < 0;

  const submit = () => {
    dispatch(adjustBalance({
      userId: user.id,
      account,
      delta: direction === 'credit' ? value : -value,
      search,
    }));
    onClose();
  };

  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="xs">
      <DialogTitle>Adjust balance</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" fontSize={13} sx={{ mb: 2 }}>
          {user.name} · {user.email}
        </Typography>
        <Stack spacing={2}>
          <ToggleButtonGroup
            exclusive fullWidth size="small" value={direction}
            onChange={(_, v) => v && setDirection(v)}
          >
            <ToggleButton value="credit" color="success">Credit</ToggleButton>
            <ToggleButton value="debit" color="error">Debit</ToggleButton>
          </ToggleButtonGroup>
          <TextField select label="Account" value={account}
            onChange={(e) => setAccount(e.target.value as 'live' | 'demo')}>
            <MenuItem value="live">Live</MenuItem>
            <MenuItem value="demo">Demo</MenuItem>
          </TextField>
          <TextField
            label="Amount (USD)" value={amount} autoFocus
            onChange={(e) => setAmount(e.target.value)}
            error={!!amount && !valid}
            helperText={
              overdraft ? 'That would take the balance below zero'
              : valid ? `${account} balance: $${current.toFixed(2)} → $${next.toFixed(2)}`
              : 'Enter a positive amount'
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid || overdraft} onClick={submit}>
          {direction === 'credit' ? 'Credit' : 'Debit'} ${valid ? value.toFixed(2) : '0.00'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
