import { runOneShotCli, OneShotResult } from "./oneshot"

export type PackageRunResult = OneShotResult

/** Run `pesde <args>` in the given project directory. */
export function runPesde(args: string[], cwd: string): Promise<PackageRunResult> {
  return runOneShotCli("pesde", args, cwd)
}
