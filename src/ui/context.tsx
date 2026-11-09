import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ActionInput } from "../core/actions";
import { today } from "../core/dates";
import type { Data, Task } from "../core/model";
import type { Store, SyncStatus } from "../sync/store";

export interface UiApi {
  openTask: (id: string) => void;
  /** Check off or un-check a task. `on`: log it on that earlier day (from a past day's view). */
  complete: (task: Task, on?: string) => void;
  openDay: (day: string) => void;
}

export const StoreContext = createContext<Store | null>(null);
export const UiContext = createContext<UiApi | null>(null);
/** Set inside a past day's view when check-offs there should count for that day. */
export const CompleteOnContext = createContext<string | undefined>(undefined);

export function useTaskLube(): { data: Data; status: SyncStatus; dispatch: (a: ActionInput) => void; day: string; store: Store } {
  const store = useContext(StoreContext)!;
  const data = useSyncExternalStore(store.subscribe, () => store.view);
  const status = useSyncExternalStore(store.subscribe, () => store.status);
  const day = useToday();
  return { data, status, dispatch: store.dispatch, day, store };
}

/** Current data plus archived history, for history views. Starts loading archives on first use. */
export function useHistory(): { history: Data; loading: boolean } {
  const store = useContext(StoreContext)!;
  useEffect(() => store.ensureHistory(), [store]);
  const history = useSyncExternalStore(store.subscribe, store.history);
  return { history, loading: store.historyLoading };
}

export function useUi(): UiApi {
  return useContext(UiContext)!;
}

/** Today's date, updating at midnight (checked every minute). */
export function useToday(): string {
  const [d, setD] = useState(today());
  useEffect(() => {
    const id = window.setInterval(() => setD(today()), 60000);
    return () => window.clearInterval(id);
  }, []);
  return d;
}

export function useHash(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parts;
}

export function go(path: string) {
  window.location.hash = "#/" + path;
}
