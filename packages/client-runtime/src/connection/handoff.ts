import type { PreparedConnection } from "./model.ts";
import type { RpcSession } from "../rpc/session.ts";

// A route upgrade opens the new session before it retires the old one, so data
// that followed the old session can resume from its cursor instead of reloading.
const handoffs = new WeakMap<RpcSession, RpcSession>();
const handoffPrepared = new WeakSet<PreparedConnection>();

export function recordHandoff(
  next: RpcSession,
  previous: RpcSession,
  prepared?: PreparedConnection,
): void {
  handoffs.set(next, previous);
  if (prepared !== undefined) handoffPrepared.add(prepared);
}

/** True when `next` replaced `previous` in a route upgrade, with no gap between them. */
export function continuesSession(next: RpcSession, previous: RpcSession): boolean {
  return handoffs.get(next) === previous;
}

/** True when `prepared` came from a seamless route upgrade rather than a fresh reconnect. */
export function isHandoffPrepared(prepared: PreparedConnection): boolean {
  return handoffPrepared.has(prepared);
}
