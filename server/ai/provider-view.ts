import type { AiProviderRow } from "@shared/schema";

export type PublicProvider = {
  id: number;
  name: string;
  type: string;
  baseUrl: string;
  hasSecret: boolean;
  organization: string | null;
  project: string | null;
  extraHeaders: Record<string, string>;
  transport: string;
  detectedTransport: string | null;
  defaultModel: string;
  models: string[];
  enabled: boolean;
  isDefault: boolean;
  capabilities: Record<string, unknown>;
  lastHealthAt: string | null;
  lastHealthOk: boolean | null;
  lastHealthError: string | null;
};

export function toPublicProvider(row: AiProviderRow): PublicProvider {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.baseUrl,
    hasSecret: Boolean(row.secretCiphertext),
    organization: row.organization,
    project: row.project,
    extraHeaders: row.extraHeaders ?? {},
    transport: row.transport,
    detectedTransport: row.detectedTransport,
    defaultModel: row.defaultModel,
    models: row.models ?? [],
    enabled: row.enabled,
    isDefault: row.isDefault,
    capabilities: row.capabilities ?? {},
    lastHealthAt: row.lastHealthAt ? row.lastHealthAt.toISOString() : null,
    lastHealthOk: row.lastHealthOk,
    lastHealthError: row.lastHealthError,
  };
}

export function assertPublicProviderHasNoSecret(value: PublicProvider, plaintext: string | null): void {
  const encoded = JSON.stringify(value);
  if (plaintext && plaintext.length > 3 && encoded.includes(plaintext)) {
    throw new Error("provider public view contains the API key");
  }
  if (encoded.includes("secretCiphertext") || encoded.includes("enc:v1:")) {
    throw new Error("provider public view contains ciphertext");
  }
}
