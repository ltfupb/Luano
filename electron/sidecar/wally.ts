import { runOneShotCli, OneShotResult } from "./oneshot"

export type PackageRunResult = OneShotResult

/** Run `wally <args>` in the given project directory. */
export function runWally(args: string[], cwd: string): Promise<PackageRunResult> {
  return runOneShotCli("wally", args, cwd)
}
