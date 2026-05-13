import * as Effect from "effect/Effect";

import { runProcess } from "../processRunner.ts";
import { ProjectScriptRunnerError } from "./Errors.ts";

const MAX_SCRIPT_OUTPUT_BYTES = 64 * 1024;

export interface ProjectScriptRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export const runProjectScriptShell = (input: {
  cwd: string;
  command: string;
  env: NodeJS.ProcessEnv;
}) =>
  Effect.tryPromise({
    try: async (): Promise<ProjectScriptRunResult> => {
      if (process.platform === "win32") {
        const result = await runProcess("cmd", ["/d", "/s", "/c", input.command], {
          cwd: input.cwd,
          env: input.env,
          allowNonZeroExit: true,
          outputMode: "truncate",
          maxBufferBytes: MAX_SCRIPT_OUTPUT_BYTES,
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
        };
      }

      const result = await runProcess("sh", ["-lc", input.command], {
        cwd: input.cwd,
        env: input.env,
        allowNonZeroExit: true,
        outputMode: "truncate",
        maxBufferBytes: MAX_SCRIPT_OUTPUT_BYTES,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      };
    },
    catch: (cause) =>
      new ProjectScriptRunnerError({
        detail: `Failed to run project setup script: ${String(cause)}`,
        cause,
      }),
  });
