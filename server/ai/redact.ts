export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}
