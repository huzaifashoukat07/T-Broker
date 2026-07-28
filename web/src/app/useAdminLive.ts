import { useEffect } from 'react';
import { useAppDispatch } from './store';
import { fetchRequests, fetchSummary, fetchUsers } from '../features/admin/adminSlice';
import { TOKEN_KEY } from './api';

/**
 * Keeps the admin screen current without a reload. The server pushes
 * `admin_refresh` whenever a request is raised or resolved, or a user signs
 * up. Only admin data is refetched here — price ticks on the same socket are
 * ignored, so this never re-renders on the 500ms market feed.
 */
export function useAdminLive(search: string) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${token ?? ''}`);
      ws.onmessage = (e) => {
        let msg: { type?: string };
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type !== 'admin_refresh') return;
        dispatch(fetchSummary());
        dispatch(fetchRequests());
        dispatch(fetchUsers(search));
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [dispatch, search]);
}
