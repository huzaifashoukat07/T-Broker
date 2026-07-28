import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import authReducer from '../features/auth/authSlice';
import adminReducer from '../features/admin/adminSlice';
import walletReducer from '../features/wallet/walletSlice';

export const store = configureStore({
  reducer: { auth: authReducer, admin: adminReducer, wallet: walletReducer },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed hooks so components never reach for `any`.
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
