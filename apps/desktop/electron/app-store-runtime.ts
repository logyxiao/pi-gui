import type { SessionRef } from "@pi-gui/session-driver";
import type {
  RuntimeLoginCallbacks,
  RuntimeSettingsSnapshot,
} from "@pi-gui/session-driver/runtime-types";
import type { DesktopAppState, WorkspaceSessionTarget } from "../src/desktop-state";
import * as composer from "./app-store-composer";
import type { AppStoreInternals } from "./app-store-internals";
import { updateProjectModelSettingsFile } from "./app-store-model-settings";

export async function refreshRuntime(
  store: AppStoreInternals,
  workspaceId?: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const resolvedWorkspaceId = workspaceId || store.state.selectedWorkspaceId;
  const ws = store.workspaceRefFromState(resolvedWorkspaceId);
  if (!ws) {
    return store.emit();
  }

  return store.withErrorHandling(async () => {
    const snapshot = await store.driver.runtimeSupervisor.refreshRuntime(ws);
    store.runtimeByWorkspace.set(ws.workspaceId, snapshot);
    store.clearExtensionUiForWorkspace(ws.workspaceId);
    await store.reloadSessionsForWorkspace(ws.workspaceId);
    await store.refreshSessionCommandsForWorkspace(ws.workspaceId);
    return store.refreshState({ clearLastError: true });
  });
}

export async function setSessionModel(
  store: AppStoreInternals,
  target: WorkspaceSessionTarget,
  provider: string,
  modelId: string,
): Promise<DesktopAppState> {
  return composer.setSessionModel(store, target, provider, modelId);
}

export async function setDefaultModel(
  store: AppStoreInternals,
  workspaceId: string,
  provider: string,
  modelId: string,
): Promise<DesktopAppState> {
  const targetWorkspaceId = store.resolveModelSettingsWorkspaceId(workspaceId);
  if (store.state.modelSettingsScopeMode !== "per-repo") {
    return store.withRuntimeUpdate(targetWorkspaceId, (ws) =>
      store.driver.runtimeSupervisor.setDefaultModel(ws, { provider, modelId }),
    );
  }
  await store.initialize();
  const ws = store.workspaceRefFromState(targetWorkspaceId);
  if (!ws) {
    return store.withError(`Unknown workspace: ${targetWorkspaceId}`);
  }
  return store.withErrorHandling(async () => {
    await updateProjectModelSettingsFile(ws.path, (settings) => ({
      ...settings,
      defaultProvider: provider,
      defaultModel: modelId,
    }));
    return store.refreshState({ clearLastError: true });
  });
}

export async function setDefaultThinkingLevel(
  store: AppStoreInternals,
  workspaceId: string,
  thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
): Promise<DesktopAppState> {
  const targetWorkspaceId = store.resolveModelSettingsWorkspaceId(workspaceId);
  if (store.state.modelSettingsScopeMode !== "per-repo") {
    return store.withRuntimeUpdate(targetWorkspaceId, (ws) =>
      store.driver.runtimeSupervisor.setDefaultThinkingLevel(ws, thinkingLevel),
    );
  }
  await store.initialize();
  const ws = store.workspaceRefFromState(targetWorkspaceId);
  if (!ws) {
    return store.withError(`Unknown workspace: ${targetWorkspaceId}`);
  }
  return store.withErrorHandling(async () => {
    await updateProjectModelSettingsFile(ws.path, (settings) => ({
      ...settings,
      ...(thinkingLevel ? { defaultThinkingLevel: thinkingLevel } : {}),
    }));
    return store.refreshState({ clearLastError: true });
  });
}

export async function setSessionThinkingLevel(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
): Promise<DesktopAppState> {
  return composer.setSessionThinkingLevel(store, sessionRef, thinkingLevel);
}

export async function loginProvider(
  store: AppStoreInternals,
  workspaceId: string,
  providerId: string,
  callbacks: RuntimeLoginCallbacks,
): Promise<DesktopAppState> {
  await store.initialize();
  const targetWorkspaceId = store.resolveModelSettingsWorkspaceId(workspaceId);
  const ws = store.workspaceRefFromState(workspaceId);
  if (!ws) {
    return store.withError(`Unknown workspace: ${workspaceId}`);
  }

  return store.withErrorHandling(async () => {
    const snapshot = await store.driver.runtimeSupervisor.login(ws, providerId, callbacks);
    store.runtimeByWorkspace.set(workspaceId, snapshot);
    await store.autoEnableModelsForConnectedProvider(targetWorkspaceId, providerId, snapshot);
    await store.refreshSessionCommandsForWorkspace(workspaceId);
    return store.refreshState({ clearLastError: true });
  });
}

export async function logoutProvider(
  store: AppStoreInternals,
  workspaceId: string,
  providerId: string,
): Promise<DesktopAppState> {
  return store.withRuntimeUpdate(workspaceId, (ws) =>
    store.driver.runtimeSupervisor.logout(ws, providerId),
  );
}

export async function setProviderApiKey(
  store: AppStoreInternals,
  workspaceId: string,
  providerId: string,
  apiKey: string,
): Promise<DesktopAppState> {
  return store.withRuntimeUpdate(workspaceId, (ws) =>
    store.driver.runtimeSupervisor.setProviderApiKey(ws, providerId, apiKey),
  );
}

export async function setEnableSkillCommands(
  store: AppStoreInternals,
  workspaceId: string,
  enabled: boolean,
): Promise<DesktopAppState> {
  return store.withRuntimeUpdate(
    workspaceId,
    (ws) => store.driver.runtimeSupervisor.setEnableSkillCommands(ws, enabled),
    { reloadSessions: true },
  );
}

export async function setScopedModelPatterns(
  store: AppStoreInternals,
  workspaceId: string,
  patterns: readonly string[],
): Promise<DesktopAppState> {
  const targetWorkspaceId = store.resolveModelSettingsWorkspaceId(workspaceId);
  if (store.state.modelSettingsScopeMode !== "per-repo") {
    return store.withRuntimeUpdate(targetWorkspaceId, (ws) =>
      store.driver.runtimeSupervisor.setScopedModelPatterns(ws, patterns),
    );
  }
  await store.initialize();
  const ws = store.workspaceRefFromState(targetWorkspaceId);
  if (!ws) {
    return store.withError(`Unknown workspace: ${targetWorkspaceId}`);
  }
  return store.withErrorHandling(async () => {
    await updateProjectModelSettingsFile(ws.path, (settings) => ({
      ...settings,
      enabledModels: patterns.length > 0 ? [...patterns] : undefined,
    }));
    return store.refreshState({ clearLastError: true });
  });
}

export async function setSkillEnabled(
  store: AppStoreInternals,
  workspaceId: string,
  filePath: string,
  enabled: boolean,
): Promise<DesktopAppState> {
  return store.withRuntimeUpdate(
    workspaceId,
    (ws) => store.driver.runtimeSupervisor.setSkillEnabled(ws, filePath, enabled),
    { reloadSessions: true },
  );
}

export async function setExtensionEnabled(
  store: AppStoreInternals,
  workspaceId: string,
  filePath: string,
  enabled: boolean,
): Promise<DesktopAppState> {
  return store.withRuntimeUpdate(
    workspaceId,
    (ws) => store.driver.runtimeSupervisor.setExtensionEnabled(ws, filePath, enabled),
    { reloadSessions: true },
  );
}
