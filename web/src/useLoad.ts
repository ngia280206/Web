import { useEffect, useState, useCallback } from 'react';
import { ApiError } from './api';

type State<T> = { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: ApiError };

export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, key: string) {
  const [version, setVersion] = useState(0);
  const [stored, setStored] = useState<{ key: string; version: number; state: State<T> }>({ key, version, state: { status: 'loading' } });
  useEffect(() => {
    const controller = new AbortController();
    setStored({ key, version, state: { status: 'loading' } });
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) setStored({ key, version, state: { status: 'success', data } });
    }).catch(error => {
      if (!controller.signal.aborted) setStored({ key, version, state: { status: 'error', error: error instanceof ApiError ? error : new ApiError('Không thể tải dữ liệu.', 'technical') } });
    });
    return () => controller.abort();
    // The caller supplies the complete request identity as key; no shared cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  const state: State<T> = stored.key === key && stored.version === version ? stored.state : { status: 'loading' };
  const retry = useCallback(() => setVersion(value => value + 1), []);
  return { state, retry };
}
