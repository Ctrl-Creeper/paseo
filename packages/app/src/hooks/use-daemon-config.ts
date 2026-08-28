import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";
import { useReplicaQuery } from "@/data/query";
import { daemonConfigQueryKey } from "@/data/daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

interface UseDaemonConfigResult {
  config: MutableDaemonConfig | null;
  overrideControlledPaths: readonly string[];
  isLoading: boolean;
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<MutableDaemonConfig | undefined>;
  patchConfigWithResult: (patch: MutableDaemonConfigPatch) => Promise<
    | {
        config: MutableDaemonConfig;
        restartRequiredPaths: readonly string[];
        overrideControlledPaths: readonly string[];
      }
    | undefined
  >;
}

export function useDaemonConfig(serverId: string | null): UseDaemonConfigResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryKey = useMemo(() => daemonConfigQueryKey(serverId), [serverId]);
  const [overrideControlledPaths, setOverrideControlledPaths] = useState<readonly string[]>([]);

  const configQuery = useReplicaQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    pushEvent: "status:daemon_config_changed",
    queryFn: async () => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const result = await client.getDaemonConfig();
      setOverrideControlledPaths(result.overrideControlledPaths ?? []);
      return result.config;
    },
  });

  const patchConfigWithResult = useCallback(
    async (patch: MutableDaemonConfigPatch) => {
      if (!client) {
        return undefined;
      }
      const result = await client.patchDaemonConfig(patch);
      queryClient.setQueryData(queryKey, result.config);
      const nextOverrideControlledPaths = result.overrideControlledPaths ?? [];
      setOverrideControlledPaths(nextOverrideControlledPaths);
      return {
        config: result.config,
        restartRequiredPaths: result.restartRequiredPaths ?? [],
        overrideControlledPaths: nextOverrideControlledPaths,
      };
    },
    [client, queryClient, queryKey],
  );

  const patchConfig = useCallback(
    async (patch: MutableDaemonConfigPatch) => {
      const result = await patchConfigWithResult(patch);
      return result?.config;
    },
    [patchConfigWithResult],
  );

  return {
    config: configQuery.data ?? null,
    overrideControlledPaths,
    isLoading: configQuery.isLoading,
    patchConfig,
    patchConfigWithResult,
  };
}
