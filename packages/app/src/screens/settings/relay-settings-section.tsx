import { Settings2 } from "lucide-react-native";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { getIsElectron } from "@/constants/platform";
import { getDesktopDaemonStatus, restartDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { loadDesktopSettings } from "@/desktop/settings/desktop-settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { restartDaemonFromSettings } from "./daemon-restart";
import {
  createRelaySettingsFormModel,
  type RelaySettingsField,
  type RelaySettingsValues,
} from "./relay-settings-form-model";
import { SettingsSection } from "./settings-section";

interface RelayModalSnapshot {
  values: RelaySettingsValues;
  overrideControlledPaths: readonly string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function RelayToggleRow({
  label,
  value,
  onValueChange,
  disabled,
  hint,
  testID,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled: boolean;
  hint?: string;
  testID: string;
}) {
  return (
    <View style={styles.toggleGroup}>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          accessibilityLabel={label}
          testID={testID}
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function RelaySettingsModal({
  serverId,
  snapshot,
  onClose,
}: {
  serverId: string;
  snapshot: RelayModalSnapshot;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const { patchConfigWithResult } = useDaemonConfig(serverId);
  const model = useMemo(
    () =>
      createRelaySettingsFormModel({
        initialValues: snapshot.values,
        overrideControlledPaths: snapshot.overrideControlledPaths,
      }),
    [snapshot],
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const [isPending, setIsPending] = useState(false);
  const [savedNeedsRestart, setSavedNeedsRestart] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.relay.configureTitle") }),
    [t],
  );

  const restart = useCallback(async () => {
    if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
    await restartDaemonFromSettings(serverId, `settings_relay_config_${serverId}`, {
      getIsElectron,
      getDesktopDaemonStatus,
      getDesktopSettings: loadDesktopSettings,
      restartDesktopDaemon,
      restartServer: (reason) => client.restartServer(reason),
    });
  }, [client, serverId, t]);

  const handleClose = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);
  const handleEnabledChange = useCallback(
    (value: boolean) => model.setField("enabled", value),
    [model],
  );
  const handleEndpointChange = useCallback(
    (value: string) => model.setField("endpoint", value),
    [model],
  );
  const handleUseTlsChange = useCallback(
    (value: boolean) => model.setField("useTls", value),
    [model],
  );
  const handlePublicEndpointChange = useCallback(
    (value: string) => model.setField("publicEndpoint", value),
    [model],
  );
  const handlePublicUseTlsChange = useCallback(
    (value: boolean) => model.setField("publicUseTls", value),
    [model],
  );

  const handleSubmit = useCallback(async () => {
    setIsPending(true);
    setSubmitError(null);
    try {
      if (savedNeedsRestart) {
        try {
          await restart();
          onClose();
        } catch (error) {
          setSubmitError(t("settings.host.relay.restartFailed", { error: errorMessage(error) }));
        }
        return;
      }

      const patch = model.buildPatch();
      if (!patch) return;
      const result = await patchConfigWithResult(patch);
      if (!result) throw new Error(t("workspace.terminal.hostDisconnected"));
      if (result.restartRequiredPaths.length === 0) {
        onClose();
        return;
      }

      setSavedNeedsRestart(true);
      try {
        await restart();
        onClose();
      } catch (error) {
        setSubmitError(t("settings.host.relay.restartFailed", { error: errorMessage(error) }));
      }
    } catch (error) {
      setSubmitError(t("settings.host.relay.saveFailed", { error: errorMessage(error) }));
    } finally {
      setIsPending(false);
    }
  }, [model, onClose, patchConfigWithResult, restart, savedNeedsRestart, t]);
  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const endpointOverride = model.getOverrideEnv("endpoint");
  const publicEndpointOverride = model.getOverrideEnv("publicEndpoint");
  const overrideHint = useCallback(
    (field: RelaySettingsField) => {
      const env = model.getOverrideEnv(field);
      return env ? t("settings.host.relay.controlledBy", { env }) : undefined;
    },
    [model, t],
  );
  const endpointError = state.errors.endpoint ? t("settings.host.relay.hostPortError") : undefined;
  const publicEndpointError = state.errors.publicEndpoint
    ? t("settings.host.relay.hostPortError")
    : undefined;
  let submitLabel = t("settings.host.relay.save");
  if (savedNeedsRestart) submitLabel = t("settings.host.relay.retryRestart");
  else if (model.hasRestartRequiredChanges()) {
    submitLabel = t("settings.host.relay.saveAndRestart");
  }

  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={handleClose}
      desktopMaxWidth={520}
      testID="relay-settings-modal"
    >
      <View style={styles.form}>
        <RelayToggleRow
          label={t("settings.host.relay.enabled")}
          value={state.values.enabled}
          onValueChange={handleEnabledChange}
          disabled={isPending || Boolean(model.getOverrideEnv("enabled"))}
          hint={overrideHint("enabled")}
          testID="relay-enabled-switch"
        />

        <Field
          label={t("settings.host.relay.endpoint")}
          hint={
            endpointOverride
              ? t("settings.host.relay.controlledBy", { env: endpointOverride })
              : t("settings.host.relay.endpointHint")
          }
          error={endpointError}
          testID="relay-endpoint-field"
        >
          <FormTextInput
            initialValue={state.values.endpoint}
            onChangeText={handleEndpointChange}
            editable={!isPending && !endpointOverride}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("settings.host.relay.endpoint")}
            testID="relay-endpoint-input"
          />
        </Field>

        <RelayToggleRow
          label={t("settings.host.relay.useTls")}
          value={state.values.useTls}
          onValueChange={handleUseTlsChange}
          disabled={isPending || Boolean(model.getOverrideEnv("useTls"))}
          hint={overrideHint("useTls")}
          testID="relay-use-tls-switch"
        />

        <Field
          label={t("settings.host.relay.publicEndpoint")}
          hint={
            publicEndpointOverride
              ? t("settings.host.relay.controlledBy", { env: publicEndpointOverride })
              : t("settings.host.relay.publicEndpointHint")
          }
          error={publicEndpointError}
          testID="relay-public-endpoint-field"
        >
          <FormTextInput
            initialValue={state.values.publicEndpoint}
            onChangeText={handlePublicEndpointChange}
            editable={!isPending && !publicEndpointOverride}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("settings.host.relay.publicEndpoint")}
            testID="relay-public-endpoint-input"
          />
        </Field>

        <RelayToggleRow
          label={t("settings.host.relay.publicUseTls")}
          value={state.values.publicUseTls}
          onValueChange={handlePublicUseTlsChange}
          disabled={isPending || Boolean(model.getOverrideEnv("publicUseTls"))}
          hint={overrideHint("publicUseTls")}
          testID="relay-public-use-tls-switch"
        />

        {submitError ? (
          <Text style={settingsStyles.rowError} testID="relay-settings-error">
            {submitError}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            variant="secondary"
            style={styles.actionButton}
            onPress={handleClose}
            disabled={isPending}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            style={styles.actionButton}
            onPress={handleSubmitPress}
            disabled={isPending || (!savedNeedsRestart && (!state.canSubmit || !client))}
            loading={isPending}
            testID="relay-settings-save-button"
          >
            {submitLabel}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

export function RelaySettingsSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, isLoading, overrideControlledPaths } = useDaemonConfig(serverId);
  const [modalSnapshot, setModalSnapshot] = useState<RelayModalSnapshot | null>(null);
  const supportsEndpointConfig =
    client?.getLastServerInfoMessage()?.features?.relayEndpointConfig === true;
  const relay = config?.relay;
  const endpoint = relay?.publicEndpoint ?? relay?.endpoint ?? "relay.paseo.sh:443";

  const handleOpen = useCallback(() => {
    if (!relay) return;
    setModalSnapshot({
      values: {
        enabled: relay.enabled,
        endpoint: relay.endpoint ?? "relay.paseo.sh:443",
        publicEndpoint: relay.publicEndpoint ?? relay.endpoint ?? "relay.paseo.sh:443",
        useTls: relay.useTls ?? true,
        publicUseTls: relay.publicUseTls ?? relay.useTls ?? true,
      },
      overrideControlledPaths,
    });
  }, [overrideControlledPaths, relay]);
  const handleClose = useCallback(() => setModalSnapshot(null), []);

  return (
    <SettingsSection title={t("settings.host.relay.title")}>
      <View style={settingsStyles.card} testID="host-page-relay-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {relay?.enabled
                ? t("settings.host.relay.enabledStatus")
                : t("settings.host.relay.disabledStatus")}
            </Text>
            <Text style={settingsStyles.rowHint} numberOfLines={2}>
              {supportsEndpointConfig ? endpoint : t("settings.host.relay.updateRequired")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={Settings2}
            onPress={handleOpen}
            disabled={!isConnected || isLoading || !relay || !supportsEndpointConfig}
            testID="host-page-relay-configure-button"
          >
            {t("settings.host.relay.configure")}
          </Button>
        </View>
      </View>
      {modalSnapshot ? (
        <RelaySettingsModal serverId={serverId} snapshot={modalSnapshot} onClose={handleClose} />
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  toggleGroup: {
    gap: theme.spacing[1],
  },
  toggleRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
  },
  toggleLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
