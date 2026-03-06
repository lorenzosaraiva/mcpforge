export function isNonInteractiveRuntime(): boolean {
  return process.env.MCPFORGE_NON_INTERACTIVE === "1" || !process.stdin.isTTY || !process.stdout.isTTY;
}
