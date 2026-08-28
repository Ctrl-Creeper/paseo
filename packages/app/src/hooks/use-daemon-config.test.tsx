/** @vitest-environment jsdom */
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDaemonConfig } from "./use-daemon-config";

const runtime = vi.hoisted(() => ({
  client: {
    getDaemonConfig: vi.fn(),
    patchDaemonConfig: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => runtime.client,
  useHostRuntimeIsConnected: () => true,
}));

describe("useDaemonConfig", () => {
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    runtime.client.getDaemonConfig.mockReset();
    runtime.client.patchDaemonConfig.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it("keeps launch override metadata with cached daemon config across remounts", async () => {
    runtime.client.getDaemonConfig.mockResolvedValue({
      requestId: "req-config",
      config: { relay: { enabled: true, endpoint: "relay.example.com:443" } },
      overrideControlledPaths: ["daemon.relay.endpoint"],
    });

    const first = renderHook(() => useDaemonConfig("host-a"), { wrapper });
    await waitFor(() =>
      expect(first.result.current.overrideControlledPaths).toEqual(["daemon.relay.endpoint"]),
    );
    first.unmount();

    const second = renderHook(() => useDaemonConfig("host-a"), { wrapper });

    expect(second.result.current.config?.relay?.endpoint).toBe("relay.example.com:443");
    expect(second.result.current.overrideControlledPaths).toEqual(["daemon.relay.endpoint"]);
    expect(runtime.client.getDaemonConfig).toHaveBeenCalledOnce();
  });
});
