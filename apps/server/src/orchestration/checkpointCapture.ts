import type { OrchestrationCheckpointStatus } from "@t3tools/contracts";

export type WritableCheckpointSettlementStatus = Exclude<OrchestrationCheckpointStatus, "missing">;

/**
 * Historical event-store replay may still surface placeholder checkpoint
 * settlements with status "missing". New code must never emit that status.
 */
export function isLegacyMissingCheckpointStatus(
  status: OrchestrationCheckpointStatus,
): status is "missing" {
  return status === "missing";
}
