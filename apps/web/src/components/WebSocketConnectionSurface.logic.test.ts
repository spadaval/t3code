import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SlowRpcAckRequest } from "../rpc/requestLatencyState";
import type { WsConnectionStatus } from "../rpc/wsConnectionState";
import { describeSlowRpcAckToast, shouldAutoReconnect } from "./WebSocketConnectionSurface";

function makeStatus(overrides: Partial<WsConnectionStatus> = {}): WsConnectionStatus {
  return {
    attemptCount: 0,
    closeCode: null,
    closeReason: null,
    connectedAt: null,
    disconnectedAt: null,
    hasConnected: false,
    lastError: null,
    lastErrorAt: null,
    nextRetryAt: null,
    online: true,
    phase: "idle",
    reconnectAttemptCount: 0,
    reconnectMaxAttempts: 8,
    reconnectPhase: "idle",
    socketUrl: null,
    ...overrides,
  };
}

describe("WebSocketConnectionSurface.logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T15:00:10.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forces reconnect on online when the app was offline", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          disconnectedAt: "2026-04-03T20:00:00.000Z",
          online: false,
          phase: "disconnected",
        }),
        "online",
      ),
    ).toBe(true);
  });

  it("forces reconnect on focus only for previously connected disconnected states", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 3,
          reconnectPhase: "waiting",
        }),
        "focus",
      ),
    ).toBe(true);

    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: false,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 1,
          reconnectPhase: "waiting",
        }),
        "focus",
      ),
    ).toBe(false);
  });

  it("forces reconnect on focus for exhausted reconnect loops", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 8,
          reconnectPhase: "exhausted",
        }),
        "focus",
      ),
    ).toBe(true);
  });

  it("describes the slowest RPC with method, request id, and threshold details", () => {
    const requests: ReadonlyArray<SlowRpcAckRequest> = [
      {
        requestId: "rpc-17",
        startedAt: "2026-04-04T15:00:05.000Z",
        startedAtMs: Date.parse("2026-04-04T15:00:05.000Z"),
        tag: "git.status",
        thresholdMs: 2_500,
      },
    ];

    const description = String(describeSlowRpcAckToast(requests));

    expect(description).toContain("RPC git.status (request rpc-17)");
    expect(description).toContain("has been waiting 5.0s for its first server ack");
    expect(description).toContain("exceeding the 2.5s threshold.");
    expect(description).toContain("Started ");
  });

  it("mentions additional delayed RPCs when more than one request is slow", () => {
    const requests: ReadonlyArray<SlowRpcAckRequest> = [
      {
        requestId: "rpc-17",
        startedAt: "2026-04-04T15:00:05.000Z",
        startedAtMs: Date.parse("2026-04-04T15:00:05.000Z"),
        tag: "git.status",
        thresholdMs: 2_500,
      },
      {
        requestId: "rpc-18",
        startedAt: "2026-04-04T15:00:06.000Z",
        startedAtMs: Date.parse("2026-04-04T15:00:06.000Z"),
        tag: "server.getConfig",
        thresholdMs: 2_500,
      },
    ];

    const description = String(describeSlowRpcAckToast(requests));

    expect(description).toContain("RPC git.status (request rpc-17)");
    expect(description).toContain("1 other request is also delayed.");
  });
});
