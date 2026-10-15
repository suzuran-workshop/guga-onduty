/**
 * 通用异步数据加载 hook —— 10 个页面共用（load / loading / error / reload）。
 *
 * 设计：
 *  - fn 用 ref 持有，避免每次渲染重建（deps 由调用方控制何时重跑）。
 *  - alive flag 防 race（React 19 StrictMode 双调用 + deps 变化时的竞态）。
 *  - reload 手动刷新（DashboardPage 刷新按钮、RecordPage 提交后重载）。
 *  - setData 乐观更新（可选）。
 */
import { useState, useEffect, useCallback, useRef } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface UseAsyncResult<T> extends AsyncState<T> {
  reload: () => void;
  setData: (d: T | null) => void;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList = [],
  options?: { immediate?: boolean },
): UseAsyncResult<T> {
  const immediate = options?.immediate !== false;
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: immediate, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef
      .current()
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (alive) {
          const message = e instanceof Error ? e.message : '加载失败';
          setState((s) => ({ ...s, loading: false, error: message }));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!immediate) return;
    return run();
    // deps 由调用方控制重跑时机（eslint-disable：fn 用 ref 持有，不进 deps）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => {
    run();
  }, [run]);
  const setData = useCallback((d: T | null) => setState((s) => ({ ...s, data: d })), []);

  return { ...state, reload, setData };
}
