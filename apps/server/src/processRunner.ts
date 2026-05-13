// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
import { type ChildProcess as ChildProcessHandle, spawn, spawnSync } from "node:child_process";
import * as Data from "effect/Data";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  collectUint8StreamText,
  type CollectedUint8StreamText,
} from "./stream/collectUint8StreamText.ts";

export interface ProcessRunInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly spawnCwd?: string | undefined;
  readonly timeout?: Duration.Input | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly stdin?: string | undefined;
  readonly maxOutputBytes?: number | undefined;
  readonly outputMode?: "error" | "truncate" | undefined;
  readonly truncatedMarker?: string | undefined;
  readonly shell?: boolean | string | undefined;
  /**
   * On timeout, return a synthetic timedOut result.
   * Partial stdout/stderr are not preserved.
   */
  readonly timeoutBehavior?: "error" | "timedOutResult" | undefined;
}

export interface ProcessRunOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: ChildProcessSpawner.ExitCode | null;
  readonly signal?: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface ProcessRunOptions {
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  stdin?: string | undefined;
  allowNonZeroExit?: boolean | undefined;
  maxBufferBytes?: number | undefined;
  outputMode?: "error" | "truncate" | undefined;
}

export class ProcessSpawnError extends Data.TaggedError("ProcessSpawnError")<{
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly cause: unknown;
}> {}

export class ProcessStdinError extends Data.TaggedError("ProcessStdinError")<{
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly cause: unknown;
}> {}

export class ProcessOutputLimitError extends Data.TaggedError("ProcessOutputLimitError")<{
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly stream: "stdout" | "stderr";
  readonly maxBytes: number;
}> {}

export class ProcessReadError extends Data.TaggedError("ProcessReadError")<{
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly stream: "stdout" | "stderr" | "exitCode";
  readonly cause: unknown;
}> {}

export class ProcessTimeoutError extends Data.TaggedError("ProcessTimeoutError")<{
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly timeoutMs: number;
}> {}

export type ProcessRunError =
  | ProcessSpawnError
  | ProcessStdinError
  | ProcessOutputLimitError
  | ProcessReadError
  | ProcessTimeoutError;

export interface ProcessRunnerShape {
  readonly run: (input: ProcessRunInput) => Effect.Effect<ProcessRunOutput, ProcessRunError>;
}

export class ProcessRunner extends Context.Service<ProcessRunner, ProcessRunnerShape>()(
  "t3/process/ProcessRunner",
) {}

const DEFAULT_TIMEOUT = "60 seconds";
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const WINDOWS_COMMAND_NOT_FOUND_PATTERNS = [
  /is not recognized as an internal or external command/i,
  /n.o . reconhecido como um comando interno/i,
  /non . riconosciuto come comando interno o esterno/i,
  /n.est pas reconnu en tant que commande interne/i,
  /no se reconoce como un comando interno o externo/i,
  /wird nicht als interner oder externer befehl/i,
] as const;

function hasWindowsCommandNotFoundMessage(output: string): boolean {
  return WINDOWS_COMMAND_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(output));
}

export function isWindowsCommandNotFound(code: number | null, stderr: string): boolean {
  if (process.platform !== "win32") return false;
  if (code === 9009) return true;
  return hasWindowsCommandNotFoundMessage(stderr);
}

function commandLabel(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

function normalizeSpawnError(command: string, args: readonly string[], error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Failed to run ${commandLabel(command, args)}.`);
  }

  const maybeCode = (error as NodeJS.ErrnoException).code;
  if (maybeCode === "ENOENT") {
    return new Error(`Command not found: ${command}`);
  }

  return new Error(`Failed to run ${commandLabel(command, args)}: ${error.message}`);
}

function normalizeExitError(
  command: string,
  args: readonly string[],
  result: ProcessRunOutput,
): Error {
  if (isWindowsCommandNotFound(result.code, result.stderr)) {
    return new Error(`Command not found: ${command}`);
  }

  const reason = result.timedOut
    ? "timed out"
    : `failed (code=${result.code ?? "null"}, signal=${result.signal ?? "null"})`;
  const stderr = result.stderr.trim();
  const detail = stderr.length > 0 ? ` ${stderr}` : "";
  return new Error(`${commandLabel(command, args)} ${reason}.${detail}`);
}

function normalizeStdinError(command: string, args: readonly string[], error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Failed to write stdin for ${commandLabel(command, args)}.`);
  }
  return new Error(`Failed to write stdin for ${commandLabel(command, args)}: ${error.message}`);
}

function appendChunkWithinLimit(
  target: string,
  currentBytes: number,
  chunk: Buffer,
  maxBytes: number,
): {
  next: string;
  nextBytes: number;
  truncated: boolean;
} {
  const remaining = maxBytes - currentBytes;
  if (remaining <= 0) {
    return { next: target, nextBytes: currentBytes, truncated: true };
  }
  if (chunk.length <= remaining) {
    return {
      next: `${target}${chunk.toString()}`,
      nextBytes: currentBytes + chunk.length,
      truncated: false,
    };
  }
  return {
    next: `${target}${chunk.subarray(0, remaining).toString()}`,
    nextBytes: currentBytes + remaining,
    truncated: true,
  };
}

function killChild(child: ChildProcessHandle, signal: NodeJS.Signals = "SIGTERM"): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // Fall back to direct kill below.
    }
  }
  child.kill(signal);
}

const collectText = Effect.fn("processRunner.collectText")(function* (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly streamName: "stdout" | "stderr";
  readonly stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>;
  readonly maxOutputBytes: number;
  readonly outputMode: "error" | "truncate";
  readonly truncatedMarker: string;
}) {
  const stream = input.stream.pipe(
    Stream.mapError(
      (cause) =>
        new ProcessReadError({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          stream: input.streamName,
          cause,
        }),
    ),
  );

  if (input.outputMode === "truncate") {
    return yield* collectUint8StreamText({
      stream,
      maxBytes: input.maxOutputBytes,
      truncatedMarker: input.truncatedMarker,
    });
  }

  return yield* stream.pipe(
    Stream.runFoldEffect<
      {
        readonly chunks: Uint8Array<ArrayBufferLike>[];
        readonly bytes: number;
      },
      Uint8Array<ArrayBufferLike>,
      ProcessOutputLimitError | ProcessReadError,
      never
    >(
      () => ({ chunks: [], bytes: 0 }),
      (state, chunk) => {
        const remainingBytes = input.maxOutputBytes - state.bytes;
        if (remainingBytes <= 0 || chunk.byteLength > remainingBytes) {
          return Effect.fail(
            new ProcessOutputLimitError({
              command: input.command,
              args: input.args,
              cwd: input.cwd,
              stream: input.streamName,
              maxBytes: input.maxOutputBytes,
            }),
          );
        }

        state.chunks.push(chunk);
        return Effect.succeed({
          chunks: state.chunks,
          bytes: state.bytes + chunk.byteLength,
        });
      },
    ),
    Effect.map(
      (state): CollectedUint8StreamText => ({
        text: Buffer.concat(state.chunks, state.bytes).toString("utf8"),
        bytes: state.bytes,
        truncated: false,
      }),
    ),
  );
});

function finalizeRunProcess<R>(
  effect: Effect.Effect<ProcessRunOutput, ProcessRunError, R | Scope.Scope>,
  input: ProcessRunInput,
): Effect.Effect<ProcessRunOutput, ProcessRunError, Exclude<R, Scope.Scope>> {
  const timeout = Duration.fromInputUnsafe(input.timeout ?? DEFAULT_TIMEOUT);
  const timeoutBehavior = input.timeoutBehavior ?? "error";

  return effect.pipe(
    Effect.scoped,
    Effect.timeoutOption(timeout),
    Effect.flatMap((result) => {
      if (Option.isSome(result)) {
        return Effect.succeed(result.value);
      }
      if (timeoutBehavior === "timedOutResult") {
        return Effect.succeed({
          stdout: "",
          stderr: "",
          code: null,
          timedOut: true,
          stdoutTruncated: false,
          stderrTruncated: false,
        } satisfies ProcessRunOutput);
      }
      return Effect.fail(
        new ProcessTimeoutError({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          timeoutMs: Duration.toMillis(timeout),
        }),
      );
    }),
  );
}

const runProcessCore = Effect.fn("processRunner.runProcessCore")(function* (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  input: ProcessRunInput,
): Effect.fn.Return<ProcessRunOutput, ProcessRunError, Scope.Scope> {
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const outputMode = input.outputMode ?? "error";
  const truncatedMarker = input.truncatedMarker ?? "";

  const child = yield* spawner
    .spawn(
      ChildProcess.make(input.command, [...input.args], {
        ...((input.spawnCwd ?? input.cwd) ? { cwd: input.spawnCwd ?? input.cwd } : {}),
        ...(input.env !== undefined
          ? {
              env: input.env,
              extendEnv: true,
            }
          : {}),
        ...(input.shell !== undefined ? { shell: input.shell } : {}),
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new ProcessSpawnError({
            command: input.command,
            args: input.args,
            cwd: input.cwd,
            cause,
          }),
      ),
    );

  const writeStdin =
    input.stdin === undefined
      ? Effect.void
      : Stream.run(Stream.encodeText(Stream.make(input.stdin)), child.stdin).pipe(
          Effect.mapError(
            (cause) =>
              new ProcessStdinError({
                command: input.command,
                args: input.args,
                cwd: input.cwd,
                cause,
              }),
          ),
        );

  const [stdout, stderr] = yield* Effect.all(
    [
      collectText({
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        streamName: "stdout",
        stream: child.stdout,
        maxOutputBytes,
        outputMode,
        truncatedMarker,
      }),
      collectText({
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        streamName: "stderr",
        stream: child.stderr,
        maxOutputBytes,
        outputMode,
        truncatedMarker,
      }),
      writeStdin,
    ],
    { concurrency: "unbounded" },
  );

  const exitCode = yield* child.exitCode.pipe(
    Effect.mapError(
      (cause) =>
        new ProcessReadError({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          stream: "exitCode",
          cause,
        }),
    ),
  );

  return {
    stdout: stdout.text,
    stderr: stderr.text,
    code: exitCode,
    timedOut: false,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  } satisfies ProcessRunOutput;
});

export const make = Effect.fn("makeProcessRunner")(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const run: ProcessRunnerShape["run"] = (input) =>
    finalizeRunProcess(runProcessCore(spawner, input), input);

  return ProcessRunner.of({
    run,
  });
});

export const layer = Layer.effect(ProcessRunner, make());

export async function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions = {},
): Promise<ProcessRunOutput> {
  const maxOutputBytes = options.maxBufferBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  const outputMode = options.outputMode ?? "truncate";

  return await new Promise<ProcessRunOutput>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      callback();
    };

    if (options.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killChild(child);
      }, options.timeoutMs);
    }

    child.once("error", (error) => {
      settle(() => reject(normalizeSpawnError(command, args, error)));
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const appended = appendChunkWithinLimit(stdout, stdoutBytes, chunk, maxOutputBytes);
      stdout = appended.next;
      stdoutBytes = appended.nextBytes;
      stdoutTruncated = stdoutTruncated || appended.truncated;
      if (appended.truncated && outputMode === "error") {
        settle(() => {
          killChild(child);
          reject(
            new Error(
              `Process stdout exceeded ${maxOutputBytes} bytes while running ${commandLabel(command, args)}.`,
            ),
          );
        });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const appended = appendChunkWithinLimit(stderr, stderrBytes, chunk, maxOutputBytes);
      stderr = appended.next;
      stderrBytes = appended.nextBytes;
      stderrTruncated = stderrTruncated || appended.truncated;
      if (appended.truncated && outputMode === "error") {
        settle(() => {
          killChild(child);
          reject(
            new Error(
              `Process stderr exceeded ${maxOutputBytes} bytes while running ${commandLabel(command, args)}.`,
            ),
          );
        });
      }
    });

    child.once("close", (code, signal) => {
      const result: ProcessRunOutput = {
        stdout,
        stderr,
        code: code as ChildProcessSpawner.ExitCode | null,
        signal,
        timedOut,
        stdoutTruncated,
        stderrTruncated,
      };

      if (!options.allowNonZeroExit && (timedOut || code !== 0)) {
        settle(() => reject(normalizeExitError(command, args, result)));
        return;
      }

      settle(() => resolve(result));
    });

    if (options.stdin === undefined) {
      child.stdin?.end();
      return;
    }

    child.stdin?.write(options.stdin, (error) => {
      if (error !== null && error !== undefined) {
        settle(() => reject(normalizeStdinError(command, args, error)));
        return;
      }
      child.stdin?.end();
    });
  });
}
