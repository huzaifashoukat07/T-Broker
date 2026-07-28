import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { api } from '../../app/api';

export interface AdminRequest {
  id: string;
  userId: string;
  email: string;
  name: string;
  time: number;
  type: 'deposit' | 'withdrawal';
  amount: number;
  method?: string;
  address?: string;
  binanceId?: string;
  status: 'pending';
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  country: string;
  countryCode: string;
  lastIp: string;
  demo: number;
  live: number;
  trades: number;
  wins: number;
  losses: number;
  pending: number;
  deposited: number;
  isAdmin: boolean;
  blocked: boolean;
}

export interface NoticeTemplate {
  id: string;
  label: string;
  subject: string;
}

interface AdminState {
  summary: { requests: number; users: number };
  requests: AdminRequest[];
  users: AdminUser[];
  templates: NoticeTemplate[];
  search: string;
  loadingRequests: boolean;
  loadingUsers: boolean;
  /** ids with an action in flight, so only that row shows a spinner */
  busy: string[];
  error: string | null;
}

const initialState: AdminState = {
  summary: { requests: 0, users: 0 },
  requests: [],
  users: [],
  templates: [],
  search: '',
  loadingRequests: false,
  loadingUsers: false,
  busy: [],
  error: null,
};

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export const fetchSummary = createAsyncThunk('admin/summary', () =>
  api<{ requests: number; users: number }>('/api/admin/summary'));

export const fetchRequests = createAsyncThunk('admin/requests', () =>
  api<{ requests: AdminRequest[] }>('/api/admin/requests'));

export const fetchUsers = createAsyncThunk('admin/users', (q: string) =>
  api<{ users: AdminUser[]; count: number }>(`/api/admin/users?q=${encodeURIComponent(q)}`));

export const fetchTemplates = createAsyncThunk('admin/templates', () =>
  api<{ templates: NoticeTemplate[] }>('/api/admin/notice-templates'));

/** Approve or reject a pending deposit / withdrawal. */
export const resolveRequest = createAsyncThunk(
  'admin/resolveRequest',
  async (args: { txId: string; action: 'approve' | 'reject' }, { dispatch, rejectWithValue }) => {
    try {
      await api(`/api/admin/requests/${args.txId}/${args.action}`, { method: 'POST' });
      dispatch(fetchRequests());
      dispatch(fetchSummary());
      return args.txId;
    } catch (e) {
      return rejectWithValue(message(e));
    }
  },
);

/** Credit (positive) or debit (negative) a user's balance. */
export const adjustBalance = createAsyncThunk(
  'admin/adjustBalance',
  async (
    args: { userId: string; account: 'live' | 'demo'; delta: number; search: string },
    { dispatch, rejectWithValue },
  ) => {
    try {
      await api(`/api/admin/users/${args.userId}/adjust`, {
        method: 'POST',
        body: { account: args.account, delta: args.delta },
      });
      dispatch(fetchUsers(args.search));
      return args.userId;
    } catch (e) {
      return rejectWithValue(message(e));
    }
  },
);

export const setBlocked = createAsyncThunk(
  'admin/setBlocked',
  async (args: { userId: string; blocked: boolean; search: string }, { dispatch, rejectWithValue }) => {
    try {
      await api(`/api/admin/users/${args.userId}/block`, {
        method: 'POST',
        body: { blocked: args.blocked },
      });
      dispatch(fetchUsers(args.search));
      return args.userId;
    } catch (e) {
      return rejectWithValue(message(e));
    }
  },
);

export const sendNotice = createAsyncThunk(
  'admin/sendNotice',
  async (args: { userId: string; template: string; message: string }, { rejectWithValue }) => {
    try {
      return await api<{ ok: boolean; sent: boolean; email: string }>(
        `/api/admin/users/${args.userId}/notice`,
        { method: 'POST', body: { template: args.template, message: args.message } },
      );
    } catch (e) {
      return rejectWithValue(message(e));
    }
  },
);

const adminSlice = createSlice({
  name: 'admin',
  initialState,
  reducers: {
    setSearch(state, action: { payload: string }) {
      state.search = action.payload;
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSummary.fulfilled, (state, action) => { state.summary = action.payload; })
      .addCase(fetchRequests.pending, (state) => { state.loadingRequests = true; })
      .addCase(fetchRequests.fulfilled, (state, action) => {
        state.loadingRequests = false;
        state.requests = action.payload.requests;
      })
      .addCase(fetchRequests.rejected, (state, action) => {
        state.loadingRequests = false;
        state.error = action.error.message ?? 'Failed to load requests';
      })
      .addCase(fetchUsers.pending, (state) => { state.loadingUsers = true; })
      .addCase(fetchUsers.fulfilled, (state, action) => {
        state.loadingUsers = false;
        state.users = action.payload.users;
      })
      .addCase(fetchUsers.rejected, (state, action) => {
        state.loadingUsers = false;
        state.error = action.error.message ?? 'Failed to load users';
      })
      .addCase(fetchTemplates.fulfilled, (state, action) => {
        state.templates = action.payload.templates;
      });

    // Row-level busy flags and error surfacing for every mutating action.
    const mutations = [resolveRequest, adjustBalance, setBlocked];
    for (const thunk of mutations) {
      builder
        .addCase(thunk.pending, (state, action) => {
          const arg = action.meta.arg as { txId?: string; userId?: string };
          const id = arg.txId ?? arg.userId;
          if (id) state.busy.push(id);
        })
        .addCase(thunk.fulfilled, (state, action) => {
          state.busy = state.busy.filter((i) => i !== action.payload);
        })
        .addCase(thunk.rejected, (state, action) => {
          const arg = action.meta.arg as { txId?: string; userId?: string };
          state.busy = state.busy.filter((i) => i !== (arg.txId ?? arg.userId));
          state.error = (action.payload as string) ?? 'Action failed';
        });
    }
    builder.addCase(sendNotice.rejected, (state, action) => {
      state.error = (action.payload as string) ?? 'Could not send the notice';
    });
  },
});

export const { setSearch, clearError } = adminSlice.actions;
export default adminSlice.reducer;
