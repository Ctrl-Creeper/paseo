import { normalizeRelayEndpoint } from "@getpaseo/protocol/daemon-endpoints";
import type { MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";

export interface RelaySettingsValues {
  enabled: boolean;
  endpoint: string;
  publicEndpoint: string;
  useTls: boolean;
  publicUseTls: boolean;
}

export type RelaySettingsField = keyof RelaySettingsValues;
export type RelaySettingsError = "hostPort";

export interface RelaySettingsFormState {
  values: RelaySettingsValues;
  errors: Partial<Record<RelaySettingsField, RelaySettingsError>>;
  isDirty: boolean;
  canSubmit: boolean;
  phase: "editing" | "saving" | "restartRequired" | "restarting";
  error: { kind: "save" | "restart"; message: string } | null;
}

export interface RelaySettingsFormModel {
  getState(): RelaySettingsFormState;
  subscribe(listener: () => void): () => void;
  setField<Field extends RelaySettingsField>(field: Field, value: RelaySettingsValues[Field]): void;
  buildPatch(): MutableDaemonConfigPatch | null;
  hasRestartRequiredChanges(): boolean;
  getOverrideEnv(field: RelaySettingsField): string | null;
  startSaving(): void;
  markSaveFailed(message: string): void;
  markRestartRequired(savedValues?: RelaySettingsValues): void;
  startRestarting(): void;
  markRestartFailed(message: string): void;
  close(): void;
}

const FIELD_PATHS: Record<RelaySettingsField, string> = {
  enabled: "daemon.relay.enabled",
  endpoint: "daemon.relay.endpoint",
  publicEndpoint: "daemon.relay.publicEndpoint",
  useTls: "daemon.relay.useTls",
  publicUseTls: "daemon.relay.publicUseTls",
};

const OVERRIDE_ENV: Record<RelaySettingsField, string> = {
  enabled: "PASEO_RELAY_ENABLED",
  endpoint: "PASEO_RELAY_ENDPOINT",
  publicEndpoint: "PASEO_RELAY_PUBLIC_ENDPOINT",
  useTls: "PASEO_RELAY_USE_TLS",
  publicUseTls: "PASEO_RELAY_PUBLIC_USE_TLS",
};

const RESTART_REQUIRED_FIELDS = new Set<RelaySettingsField>([
  "endpoint",
  "publicEndpoint",
  "useTls",
  "publicUseTls",
]);

function normalizeEndpoint(value: string): string | null {
  if (value.includes("://")) return null;
  try {
    return normalizeRelayEndpoint(value);
  } catch {
    return null;
  }
}

export function createRelaySettingsFormModel(input: {
  initialValues: RelaySettingsValues;
  overrideControlledPaths: readonly string[];
}): RelaySettingsFormModel {
  const initialValues = { ...input.initialValues };
  const overrideControlledPaths = new Set(input.overrideControlledPaths);
  const listeners = new Set<() => void>();
  let values = { ...initialValues };
  let phase: RelaySettingsFormState["phase"] = "editing";
  let error: RelaySettingsFormState["error"] = null;
  let closed = false;
  let state = buildState();

  function isOverridden(field: RelaySettingsField): boolean {
    return overrideControlledPaths.has(FIELD_PATHS[field]);
  }

  function normalizedValue(
    field: RelaySettingsField,
  ): RelaySettingsValues[RelaySettingsField] | null {
    const value = values[field];
    if (field === "endpoint" || field === "publicEndpoint") {
      return normalizeEndpoint(value as string);
    }
    return value;
  }

  function changedFields(): RelaySettingsField[] {
    return (Object.keys(FIELD_PATHS) as RelaySettingsField[]).filter((field) => {
      if (isOverridden(field)) return false;
      const normalized = normalizedValue(field);
      return normalized !== null && normalized !== initialValues[field];
    });
  }

  function buildState(): RelaySettingsFormState {
    const errors: RelaySettingsFormState["errors"] = {};
    for (const field of ["endpoint", "publicEndpoint"] as const) {
      if (!isOverridden(field) && normalizeEndpoint(values[field]) === null) {
        errors[field] = "hostPort";
      }
    }
    const isDirty = changedFields().length > 0;
    return {
      values: { ...values },
      errors,
      isDirty,
      canSubmit: isDirty && Object.keys(errors).length === 0,
      phase,
      error,
    };
  }

  function publish(): void {
    if (closed) return;
    state = buildState();
    for (const listener of listeners) listener();
  }

  function transition(
    nextPhase: RelaySettingsFormState["phase"],
    nextError: RelaySettingsFormState["error"] = null,
  ): void {
    phase = nextPhase;
    error = nextError;
    publish();
  }

  function setField<Field extends RelaySettingsField>(
    field: Field,
    value: RelaySettingsValues[Field],
  ): void {
    if (closed || phase !== "editing" || values[field] === value) return;
    values = { ...values, [field]: value };
    error = null;
    publish();
  }

  function buildPatch(): MutableDaemonConfigPatch | null {
    if (!state.canSubmit) return null;
    const relay: NonNullable<MutableDaemonConfigPatch["relay"]> = {};
    for (const field of changedFields()) {
      const value = normalizedValue(field);
      if (value === null) return null;
      Object.assign(relay, { [field]: value });
    }
    return { relay };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setField,
    buildPatch,
    hasRestartRequiredChanges: () =>
      changedFields().some((field) => RESTART_REQUIRED_FIELDS.has(field)),
    getOverrideEnv: (field) => (isOverridden(field) ? OVERRIDE_ENV[field] : null),
    startSaving: () => transition("saving"),
    markSaveFailed: (message) => transition("editing", { kind: "save", message }),
    markRestartRequired: (savedValues) => {
      if (savedValues) values = { ...savedValues };
      transition("restartRequired");
    },
    startRestarting: () => transition("restarting"),
    markRestartFailed: (message) => transition("restartRequired", { kind: "restart", message }),
    close() {
      closed = true;
      listeners.clear();
    },
  };
}
