import { cancel, confirm, isCancel, text } from "@clack/prompts";

function isNonInteractive(): boolean {
  return process.env.MCPFORGE_NON_INTERACTIVE === "1" || !process.stdin.isTTY || !process.stdout.isTTY;
}

export async function promptConfirm(message: string, initialValue = true): Promise<boolean> {
  if (isNonInteractive()) {
    return initialValue;
  }

  const result = await confirm({
    message,
    initialValue,
  });

  if (isCancel(result)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  return Boolean(result);
}

export async function promptText(message: string, defaultValue?: string): Promise<string> {
  if (isNonInteractive()) {
    return defaultValue ?? "";
  }

  const result = await text({
    message,
    placeholder: defaultValue,
    defaultValue,
  });

  if (isCancel(result)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  return String(result).trim();
}
