/** Turns `${status}: ${body}` errors thrown by queryClient.ts into plain copy for toasts. */
export function toUserMessage(error: unknown): { title: string; description: string } {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^(\d{3}):\s*([\s\S]*)$/.exec(message);
  const status = match ? Number(match[1]) : null;

  if (status === 401) {
    return { title: "Session expired", description: "Sign in again to continue." };
  }
  if (status === 403) {
    return { title: "Not allowed", description: "You don't have permission to do that." };
  }
  if (status === 404) {
    return { title: "Not found", description: "That item no longer exists." };
  }
  if (status && status >= 500) {
    return { title: "Something went wrong", description: "Please try again in a moment." };
  }
  if (status) {
    const body = match?.[2] ?? "";
    const parsed = safeJsonMessage(body);
    return { title: "Couldn't complete that", description: parsed ?? "Please check your input and try again." };
  }
  return { title: "Something went wrong", description: "Please try again." };
}

function safeJsonMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}
