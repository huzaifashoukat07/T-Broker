import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { api, TOKEN_KEY } from '../../app/api';

export interface User {
  id: string;
  email: string;
  name: string;
  country: string;
  balances: { demo: number; live: number; bonus: number };
  hasDeposited: boolean;
  isAdmin: boolean;
  createdAt: number;
}

export type AuthMode = 'login' | 'register' | 'reset';

interface AuthState {
  user: User | null;
  token: string | null;
  /** true once the initial /api/me check has finished */
  ready: boolean;
  mode: AuthMode;
  /** email awaiting OTP entry, null when not in the OTP step */
  pendingEmail: string | null;
  /** false when the server could not send the mail (code is in its log) */
  emailSent: boolean;
  status: 'idle' | 'loading';
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  ready: false,
  mode: 'login',
  pendingEmail: null,
  emailSent: true,
  status: 'idle',
  error: null,
};

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** Restore the session on boot; a bad or expired token clears itself. */
export const loadSession = createAsyncThunk('auth/loadSession', async () => {
  if (!localStorage.getItem(TOKEN_KEY)) return null;
  const { user } = await api<{ user: User }>('/api/me');
  return user;
});

/** Step 1 — credentials. The server replies with otpRequired and emails a code. */
export const submitCredentials = createAsyncThunk(
  'auth/submitCredentials',
  async (
    args: { mode: AuthMode; email: string; password: string; name?: string },
    { rejectWithValue },
  ) => {
    const path =
      args.mode === 'login' ? '/api/login'
      : args.mode === 'reset' ? '/api/forgot-password'
      : '/api/register';
    try {
      return await api<{ otpRequired: boolean; email: string; emailSent: boolean }>(path, {
        body: { email: args.email, password: args.password, name: args.name },
      });
    } catch (e) {
      return rejectWithValue(message(e));
    }
  },
);

/** Step 2 — the emailed code completes signup, login or password reset. */
export const verifyOtp = createAsyncThunk(
  'auth/verifyOtp',
  async (args: { email: string; code: string }, { rejectWithValue }) => {
    try {
      return await api<{ token: string; user: User }>('/api/verify-otp', { body: args });
    } catch (e) {
      return rejectWithValue(message(e));
    }
  },
);

export const resendOtp = createAsyncThunk(
  'auth/resendOtp',
  async (email: string, { rejectWithValue }) => {
    try {
      return await api<{ emailSent: boolean }>('/api/resend-otp', { body: { email } });
    } catch (e) {
      return rejectWithValue(message(e));
    }
  },
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setMode(state, action: { payload: AuthMode }) {
      state.mode = action.payload;
      state.pendingEmail = null;
      state.error = null;
    },
    backToCredentials(state) {
      state.pendingEmail = null;
      state.error = null;
    },
    clearError(state) {
      state.error = null;
    },
    logout(state) {
      localStorage.removeItem(TOKEN_KEY);
      state.user = null;
      state.token = null;
      state.pendingEmail = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSession.fulfilled, (state, action) => {
        state.user = action.payload;
        state.ready = true;
      })
      .addCase(loadSession.rejected, (state) => {
        localStorage.removeItem(TOKEN_KEY);
        state.token = null;
        state.user = null;
        state.ready = true;
      })
      .addCase(submitCredentials.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(submitCredentials.fulfilled, (state, action) => {
        state.status = 'idle';
        state.pendingEmail = action.payload.email;
        state.emailSent = action.payload.emailSent;
      })
      .addCase(submitCredentials.rejected, (state, action) => {
        state.status = 'idle';
        state.error = (action.payload as string) ?? 'Something went wrong';
      })
      .addCase(verifyOtp.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(verifyOtp.fulfilled, (state, action) => {
        state.status = 'idle';
        state.token = action.payload.token;
        state.user = action.payload.user;
        state.pendingEmail = null;
        localStorage.setItem(TOKEN_KEY, action.payload.token);
      })
      .addCase(verifyOtp.rejected, (state, action) => {
        state.status = 'idle';
        state.error = (action.payload as string) ?? 'Something went wrong';
      })
      .addCase(resendOtp.fulfilled, (state, action) => {
        state.emailSent = action.payload.emailSent;
      });
  },
});

export const { setMode, backToCredentials, clearError, logout } = authSlice.actions;
export default authSlice.reducer;
