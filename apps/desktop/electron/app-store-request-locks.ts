import type { DesktopAppState } from "../src/desktop-state";
import type { AppStoreInternals } from "./app-store-internals";

const pendingRequestsByStore = new WeakMap<AppStoreInternals, Map<string, Promise<DesktopAppState>>>();

export function serializeStoreRequest(
  store: AppStoreInternals,
  key: string,
  action: () => Promise<DesktopAppState>,
): Promise<DesktopAppState> {
  let pendingRequests = pendingRequestsByStore.get(store);
  if (!pendingRequests) {
    pendingRequests = new Map();
    pendingRequestsByStore.set(store, pendingRequests);
  }

  const pending = pendingRequests.get(key);
  if (pending) {
    return pending;
  }

  const next = action().finally(() => {
    pendingRequests?.delete(key);
  });
  pendingRequests.set(key, next);
  return next;
}
