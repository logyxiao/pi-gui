import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { buildModelOptions } from "./composer-commands";

export type ModelOnboardingTranslator = (key: never, values?: Record<string, string>) => string;

export type ModelOnboardingSettingsSection = "models" | "providers";

export interface ModelOnboardingNotice {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly actionSection: ModelOnboardingSettingsSection;
}

export interface ModelOnboardingState {
  readonly hasSelectableModels: boolean;
  readonly requiresModelSelection: boolean;
  readonly unselectedModelLabel: string;
  readonly emptyModelTitle: string;
  readonly emptyModelDescription: string;
  readonly notice?: ModelOnboardingNotice;
}

interface ModelSelectionInput {
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
}

export function deriveModelOnboardingState(
  runtime: RuntimeSnapshot | undefined,
  currentSelection: ModelSelectionInput,
  t?: ModelOnboardingTranslator,
): ModelOnboardingState {
  const selectableModels = buildModelOptions(runtime);
  const selectableSet = new Set(selectableModels.map((model) => `${model.providerId}:${model.modelId}`));
  const hasSelectableModels = selectableModels.length > 0;
  const connectedProviderCount = runtime?.providers.filter((provider) => provider.hasAuth).length ?? 0;
  const settingsDefault = {
    provider: runtime?.settings.defaultProvider,
    modelId: runtime?.settings.defaultModelId,
  };
  const hasDefaultModel = Boolean(settingsDefault.provider && settingsDefault.modelId);
  const defaultModelUsable = isUsableSelection(settingsDefault, selectableSet);
  const hasCurrentSelection = Boolean(currentSelection.provider && currentSelection.modelId);
  const currentSelectionUsable = isUsableSelection(currentSelection, selectableSet);

  if (!hasSelectableModels) {
    return {
      hasSelectableModels: false,
      requiresModelSelection: true,
      unselectedModelLabel: translate(t, "modelOnboarding.noModelsAvailable"),
      emptyModelTitle: translate(t, "modelOnboarding.noModelsAvailable"),
      emptyModelDescription:
        connectedProviderCount > 0
          ? translate(t, "modelOnboarding.enableModelsDescription")
          : translate(t, "modelOnboarding.connectProviderDescription"),
      notice: connectedProviderCount > 0
        ? {
            title: translate(t, "modelOnboarding.noModelsAvailable"),
            description: translate(t, "modelOnboarding.allModelsDisabledDescription"),
            actionLabel: translate(t, "modelOnboarding.openModelsSettings"),
            actionSection: "models",
          }
        : {
            title: translate(t, "modelOnboarding.noModelsAvailable"),
            description: translate(t, "modelOnboarding.connectProviderNotice"),
            actionLabel: translate(t, "modelOnboarding.openProvidersSettings"),
            actionSection: "providers",
          },
    };
  }

  if (hasCurrentSelection && !currentSelectionUsable) {
    return {
      hasSelectableModels: true,
      requiresModelSelection: true,
      unselectedModelLabel: translate(t, "modelOnboarding.pickModel"),
      emptyModelTitle: translate(t, "modelOnboarding.noModelsAvailable"),
      emptyModelDescription: translate(t, "modelOnboarding.pickModelDescription"),
      notice: {
        title: translate(t, "modelOnboarding.selectedUnavailableTitle"),
        description: hasDefaultModel
          ? translate(t, "modelOnboarding.selectedUnavailableHasDefault")
          : translate(t, "modelOnboarding.selectedUnavailableNoDefault"),
        actionLabel: translate(t, "modelOnboarding.openModelsSettings"),
        actionSection: "models",
      },
    };
  }

  if (!hasDefaultModel) {
    return {
      hasSelectableModels: true,
      requiresModelSelection: !currentSelectionUsable,
      unselectedModelLabel: translate(t, "modelOnboarding.pickModel"),
      emptyModelTitle: translate(t, "modelOnboarding.noDefaultTitle"),
      emptyModelDescription: translate(t, "modelOnboarding.pickModelDescription"),
      notice: currentSelectionUsable
        ? undefined
        : {
            title: translate(t, "modelOnboarding.noDefaultTitle"),
            description: translate(t, "modelOnboarding.noDefaultDescription"),
            actionLabel: translate(t, "modelOnboarding.openModelsSettings"),
            actionSection: "models",
          },
    };
  }

  if (!defaultModelUsable) {
    const defaultLabel = `${settingsDefault.provider}:${settingsDefault.modelId}`;
    return {
      hasSelectableModels: true,
      requiresModelSelection: !currentSelectionUsable,
      unselectedModelLabel: translate(t, "modelOnboarding.pickModel"),
      emptyModelTitle: translate(t, "modelOnboarding.defaultUnavailableTitle"),
      emptyModelDescription: translate(t, "modelOnboarding.pickModelDescription"),
      notice: {
        title: "Default model unavailable",
        description: currentSelectionUsable
          ? translate(t, "modelOnboarding.defaultUnavailableUsable", { model: defaultLabel })
          : translate(t, "modelOnboarding.defaultUnavailableNeedsChoice", { model: defaultLabel }),
        actionLabel: translate(t, "modelOnboarding.openModelsSettings"),
        actionSection: "models",
      },
    };
  }

  return {
    hasSelectableModels: true,
    requiresModelSelection: false,
    unselectedModelLabel: translate(t, "modelOnboarding.pickModel"),
    emptyModelTitle: translate(t, "modelOnboarding.noModelsAvailable"),
    emptyModelDescription: translate(t, "modelOnboarding.pickModelDescription"),
  };
}

function isUsableSelection(
  selection: ModelSelectionInput,
  selectableSet: ReadonlySet<string>,
): boolean {
  return Boolean(selection.provider && selection.modelId && selectableSet.has(`${selection.provider}:${selection.modelId}`));
}

const fallbackTranslations: Record<string, string> = {
  "modelOnboarding.noModelsAvailable": "No models available",
  "modelOnboarding.enableModelsDescription": "Open Settings > Models to enable models.",
  "modelOnboarding.connectProviderDescription": "Open Settings > Providers to connect a provider and make models available.",
  "modelOnboarding.allModelsDisabledDescription": "All available models are currently disabled. Open Settings > Models to enable models.",
  "modelOnboarding.connectProviderNotice": "Connect a provider in Settings > Providers before choosing a model or setting a default.",
  "modelOnboarding.openModelsSettings": "Open Settings > Models",
  "modelOnboarding.openProvidersSettings": "Open Settings > Providers",
  "modelOnboarding.pickModel": "Pick a model",
  "modelOnboarding.pickModelDescription": "Pick a model.",
  "modelOnboarding.selectedUnavailableTitle": "Selected model unavailable",
  "modelOnboarding.selectedUnavailableHasDefault": "The model selected for this thread is no longer available. Choose another model, then open Settings > Models to update the default.",
  "modelOnboarding.selectedUnavailableNoDefault": "The model selected for this thread is no longer available. Choose another model, then open Settings > Models to choose the app default.",
  "modelOnboarding.noDefaultTitle": "No default model set",
  "modelOnboarding.noDefaultDescription": "Set a default model in Settings > Models.",
  "modelOnboarding.defaultUnavailableTitle": "Default model unavailable",
  "modelOnboarding.defaultUnavailableUsable": "Your saved default ({model}) is no longer available. Open Settings > Models to update it.",
  "modelOnboarding.defaultUnavailableNeedsChoice": "Your saved default ({model}) is no longer available. Choose a model for this thread, then open Settings > Models to update it.",
};

function translate(t: ModelOnboardingTranslator | undefined, key: string, values?: Record<string, string>): string {
  if (t) return t(key as never, values);
  let text = fallbackTranslations[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}
