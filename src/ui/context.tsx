import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ActionInput } from "../core/actions";
import { today } from "../core/dates";
import type { Data, Task } from "../core/model";
import type { Store, SyncStatus } from "../sync/store";

export interface UiApi {
  openTask: (id: string) => void;
  complete: (task: Task) => void;
  openDay: (day: string) => void;
}

export const StoreContext = createContext<Store | null>(null);
export const UiContext = createContext<UiApi | null>(null);

export function useTaskLube(): { data: Data; status: SyncStatus; dispatch: (a: ActionInput) => void; day: string; store: Store } {
  const store = useContext(StoreContext)!;
  const data = useSyncExternalStore(store.subscribe, () => store.view);
  const status = useSyncExternalStore(store.subscribe, () => store.status);
  const day = useToday();
  return { data, status, dispatch: store.dispatch, day, store };
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
