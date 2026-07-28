import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Alert, Box, Button, Link, Paper, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { useAppDispatch, useAppSelector } from '../app/store';
import {
  backToCredentials, clearError, resendOtp, setMode, submitCredentials, verifyOtp,
  type AuthMode,
} from '../features/auth/authSlice';
import BrandMark from '../components/BrandMark';
import { tokens } from '../theme/theme';

const SUBMIT_LABEL: Record<AuthMode, string> = {
  login: 'Log in',
  register: 'Create account',
  reset: 'Send reset code',
};
const RESEND_SECONDS = 45;

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const location = useLocation() as { state?: { from?: string } };
  const { user, mode, pendingEmail, emailSent, status, error } = useAppSelector((s) => s.auth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // Countdown for the resend button while an OTP is outstanding.
  useEffect(() => {
    if (!pendingEmail) return;
    setCode('');
    setCooldown(RESEND_SECONDS);
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [pendingEmail]);

  // Six digits is the whole code, so submit as soon as it is complete.
  useEffect(() => {
    if (pendingEmail && code.length === 6) {
      dispatch(verifyOtp({ email: pendingEmail, code }));
    }
  }, [code, pendingEmail, dispatch]);

  // Once signed in, hand over to the trading app. That screen is still served
  // by the original frontend, so this is a real navigation out of /app rather
  // than a client-side route. Both share the same token in localStorage, so
  // the trading app picks the session straight up.
  useEffect(() => {
    if (user) window.location.replace(location.state?.from ?? '/trade');
  }, [user, location.state]);

  if (user) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <Typography color="text.secondary">Signing you in…</Typography>
      </Box>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pendingEmail) dispatch(verifyOtp({ email: pendingEmail, code }));
    else dispatch(submitCredentials({ mode, email, password, name }));
  };

  return (
    <Box
      sx={{
        display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 2,
        background: `radial-gradient(1200px 700px at 70% -10%, #16224a 0%, ${tokens.bg} 55%)`,
      }}
    >
      <Paper sx={{ width: 400, maxWidth: '100%', p: { xs: 3, sm: 4.5 }, borderRadius: 4 }}>
        <Typography align="center" sx={{ mb: 1 }}><BrandMark size={30} /></Typography>
        <Typography align="center" color="text.secondary" fontSize={13} sx={{ mb: 3 }}>
          Trade currencies, crypto and commodities
        </Typography>

        {!pendingEmail && (
          <Tabs
            value={mode === 'reset' ? 'login' : mode}
            onChange={(_, v) => dispatch(setMode(v as AuthMode))}
            variant="fullWidth"
            sx={{ mb: 3, bgcolor: tokens.bg2, borderRadius: 2.5, minHeight: 44 }}
          >
            <Tab value="login" label="Log in" sx={{ minHeight: 44 }} />
            <Tab value="register" label="Sign up" sx={{ minHeight: 44 }} />
          </Tabs>
        )}

        <form onSubmit={onSubmit}>
          <Stack spacing={2}>
            {error && <Alert severity="error" onClose={() => dispatch(clearError())}>{error}</Alert>}

            {pendingEmail ? (
              <>
                <Typography align="center" color="text.secondary" fontSize={13.5}>
                  We emailed a 6-digit code to <b style={{ color: tokens.text }}>{pendingEmail}</b>
                </Typography>
                {!emailSent && (
                  <Alert severity="warning">
                    Email could not be sent — the code is printed in the server log.
                  </Alert>
                )}
                <TextField
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  inputProps={{
                    inputMode: 'numeric',
                    style: { textAlign: 'center', fontSize: 24, fontWeight: 800, letterSpacing: 12 },
                  }}
                />
                <Stack direction="row" justifyContent="space-between">
                  <Link component="button" type="button" underline="hover" fontSize={13}
                    onClick={() => dispatch(backToCredentials())}>
                    ← Back
                  </Link>
                  <Link component="button" type="button" underline="hover" fontSize={13}
                    sx={{ color: cooldown ? tokens.muted : tokens.accent }}
                    onClick={() => { if (!cooldown) dispatch(resendOtp(pendingEmail)); }}>
                    {cooldown ? `Resend code (${cooldown}s)` : 'Resend code'}
                  </Link>
                </Stack>
              </>
            ) : (
              <>
                {mode === 'register' && (
                  <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
                )}
                <TextField
                  label="Email" type="email" required autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                />
                <TextField
                  label={mode === 'reset' ? 'New password' : 'Password'}
                  type="password" required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
                {mode === 'login' && (
                  <Link component="button" type="button" underline="hover" fontSize={12.5}
                    sx={{ alignSelf: 'flex-end' }} onClick={() => dispatch(setMode('reset'))}>
                    Forgot password?
                  </Link>
                )}
              </>
            )}

            <Button type="submit" variant="contained" disabled={status === 'loading'}>
              {pendingEmail
                ? (mode === 'reset' ? 'Reset password' : 'Verify code')
                : SUBMIT_LABEL[mode]}
            </Button>
          </Stack>
        </form>

        <Typography align="center" color="text.secondary" fontSize={12.5} sx={{ mt: 2.5 }}>
          New accounts start with <Box component="b" sx={{ color: tokens.up }}>$10,000</Box> in a demo balance
        </Typography>
      </Paper>
    </Box>
  );
}
