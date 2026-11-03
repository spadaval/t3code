import type { RpcSession } from "../rpc/session.ts";

// A route upgrade opens the new session before it retires the old one, so data
// that followed the old session can resume from its cursor instead of reloading.
const handoffs = new WeakMap<RpcSession, RpcSession>();

export function recordHandoff(next: RpcSession, previous: RpcSession): void {
  handoffs.set(next, previous);
}

/** True when `next` replaced `previous` in a route upgrade, with no gap between them. */
export function continuesSession(next: RpcSession, previous: RpcSession): boolean {
  return handoffs.get(next) === previous;
}
