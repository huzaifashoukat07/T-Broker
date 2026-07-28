import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { api } from '../../app/api';

export type PayMethod = 'binance' | 'usdt-bep20' | 'usdt-trc20';

export interface Wallet {
  address: string;
  name: string;
  network: string;
  qr: string | null;
}

export interface Transaction {
  id: string;
  time: number;
  type: 'deposit' | 'withdrawal';
  amount: number;
  method?: string;
  address?: string;
  binanceId?: string;
  status: 'pending' | 'completed' | 'rejected';
  bonus?: number;
  bonusForfeited?: number;
}

interface WalletState {
  /** deposit addresses + generated QR codes, keyed by network */
  wallets: Record<string, Wallet>;
  promoPct: number;
  transactions: Transaction[];
  loadingTx: boolean;
  submitting: boolean;
  error: string | null;
  /** set after a successful request so the page can show a receipt */
  lastDeposit: { amount: number; bonus: number } | null;
  lastWithdrawal: { amount: number; bonusForfeited: number } | null;
}

const initialState: WalletState = {
  wallets: {},
  promoPct: 100,
  transactions: [],
  loadingTx: false,
  submitting: false,
  error: null,
  lastDeposit: null,
  lastWithdrawal: null,
};

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** Wallet addresses, QR codes and the promo percentage come from /api/assets. */
export const fetchWalletConfig = createAsyncThunk('wallet/config', () =>
  api<{ wallets: Record<string, Wallet>; promo: { pct: number } }>('/api/assets'));

export const fetchTransactions = createAsyncThunk('wallet/transactions', () =>
  api<{ transactions: Transaction[] }>('/api/transactions'));

export const submitDeposit = createAsyncThunk(
  'wallet/deposit',
  async (args: { amount: number; method: PayMethod; promo?: string }, { dispatch, rejectWithValue }) => {
    try {
      const res = await api<{ pending: boolean; bonus: number }>('/api/deposit', { body: args });
      dispatch(fetchTransactions());
      return { amount: args.amount, bonus: res.bonus };
    } catch (e) {
      return rejectWithValue(message(e));
    }
  },
);

export const submitWithdrawal = createAsyncThunk(
  'wallet/withdraw',
  async (
    args: { amount: number; method: PayMethod; binanceId?: string; address?: string },
    { dispatch, rejectWithValue },
  ) => {
    try {
      const res = await api<{ balances: { demo: number; live: number; bonus: number }; bonusForfeited: number }>(
        '/api/withdraw', { body: args },
      );
      dispatch(fetchTransactions());
      return { amount: args.amount, bonusForfeited: res.bonusForfeited, balances: res.balances };
    } catch (e) {
      return rejectWithValue(message(e));
    }
  },
);

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    clearError(state) { state.error = null; },
    clearReceipts(state) { state.lastDeposit = null; state.lastWithdrawal = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWalletConfig.fulfilled, (state, action) => {
        state.wallets = action.payload.wallets || {};
        state.promoPct = action.payload.promo?.pct ?? 100;
      })
      .addCase(fetchTransactions.pending, (state) => { state.loadingTx = true; })
      .addCase(fetchTransactions.fulfilled, (state, action) => {
        state.loadingTx = false;
        state.transactions = action.payload.transactions;
      })
      .addCase(fetchTransactions.rejected, (state) => { state.loadingTx = false; })
      .addCase(submitDeposit.pending, (state) => { state.submitting = true; state.error = null; })
      .addCase(submitDeposit.fulfilled, (state, action) => {
        state.submitting = false;
        state.lastDeposit = action.payload;
      })
      .addCase(submitDeposit.rejected, (state, action) => {
        state.submitting = false;
        state.error = (action.payload as string) ?? 'Deposit failed';
      })
      .addCase(submitWithdrawal.pending, (state) => { state.submitting = true; state.error = null; })
      .addCase(submitWithdrawal.fulfilled, (state, action) => {
        state.submitting = false;
        state.lastWithdrawal = {
          amount: action.payload.amount,
          bonusForfeited: action.payload.bonusForfeited,
        };
      })
      .addCase(submitWithdrawal.rejected, (state, action) => {
        state.submitting = false;
        state.error = (action.payload as string) ?? 'Withdrawal failed';
      });
  },
});

export const { clearError, clearReceipts } = walletSlice.actions;
export default walletSlice.reducer;
