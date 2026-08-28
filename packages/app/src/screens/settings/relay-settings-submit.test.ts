import { describe, expect, it, vi } from "vitest";
import { createRelaySettingsFormModel } from "./relay-settings-form-model";
import { submitRelaySettings } from "./relay-settings-submit";

const initialValues = {
  enabled: false,
  endpoint: "relay.paseo.sh:443",
  publicEndpoint: "relay.paseo.sh:443",
  useTls: true,
  publicUseTls: true,
};

function createModel() {
  const model = createRelaySettingsFormModel({ initialValues, overrideControlledPaths: [] });
  model.setField("endpoint", "relay.internal.example:7443");
  model.setField("publicEndpoint", "relay.example.com:443");
  return model;
}

describe("submitRelaySettings", () => {
  it("saves, migrates the local relay connection, and waits for restart", async () => {
    const model = createModel();
    const order: string[] = [];

    const result = await submitRelaySettings({
      model,
      patchConfig: async () => {
        order.push("save");
        return {
          config: {
            relay: {
              enabled: false,
              endpoint: "relay.internal.example:7443",
              publicEndpoint: "relay.example.com:443",
              useTls: true,
              publicUseTls: true,
            },
          },
          restartRequiredPaths: ["daemon.relay.endpoint"],
        };
      },
      migrateRelayConnection: async () => order.push("migrate"),
      restart: async () => order.push("restart"),
      formatSaveError: (error) => `save: ${String(error)}`,
      formatRestartError: (error) => `restart: ${String(error)}`,
    });

    expect(result).toBe("close");
    expect(order).toEqual(["save", "migrate", "restart"]);
  });

  it("locks saved fields and offers restart retry after reconnect failure", async () => {
    const model = createModel();
    const patchConfig = vi.fn(async () => ({
      config: {
        relay: {
          enabled: false,
          endpoint: "relay.internal.example:7443",
          publicEndpoint: "relay.example.com:443",
          useTls: true,
          publicUseTls: true,
        },
      },
      restartRequiredPaths: ["daemon.relay.endpoint"],
    }));
    const restart = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const input = {
      model,
      patchConfig,
      migrateRelayConnection: vi.fn(async () => undefined),
      restart,
      formatSaveError: (error: unknown) => `save: ${String(error)}`,
      formatRestartError: (error: unknown) => `restart: ${String(error)}`,
    };

    await expect(submitRelaySettings(input)).resolves.toBe("stayOpen");
    expect(model.getState()).toMatchObject({
      phase: "restartRequired",
      error: { kind: "restart", message: "restart: Error: offline" },
    });
    model.setField("endpoint", "relay.unsaved.example:443");
    expect(model.getState().values.endpoint).toBe("relay.internal.example:7443");

    await expect(submitRelaySettings(input)).resolves.toBe("close");
    expect(patchConfig).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledTimes(2);
  });
});
