/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRelaySettingsFormModel } from "./use-relay-settings-form-model";

const snapshot = {
  initialValues: {
    enabled: true,
    endpoint: "relay.paseo.sh:443",
    publicEndpoint: "relay.paseo.sh:443",
    useTls: true,
    publicUseTls: true,
  },
  overrideControlledPaths: [] as string[],
};

describe("useRelaySettingsFormModel", () => {
  it("keeps one model for the mount and closes it on unmount", () => {
    const { result, rerender, unmount } = renderHook(
      ({ input }) => useRelaySettingsFormModel(input),
      { initialProps: { input: snapshot } },
    );
    const model = result.current;
    model.setField("endpoint", "relay.edited.example:443");

    rerender({ input: { ...snapshot } });
    expect(result.current).toBe(model);
    expect(result.current.getState().values.endpoint).toBe("relay.edited.example:443");

    unmount();
    model.setField("endpoint", "relay.after-close.example:443");
    expect(model.getState().values.endpoint).toBe("relay.edited.example:443");
  });
});
