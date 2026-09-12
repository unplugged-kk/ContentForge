/**
 * Deterministic template rendering (pure).
 *
 * Kept free of any imports beyond the schema type so both the authoring service
 * and the policy/prompt assembly can use it without a module cycle.
 *
 * Rendering is explicit: a declared-but-unsupplied variable becomes
 * `[missing: name]` (never silently dropped), and a placeholder that is not
 * declared is reported as an authoring error by the policy resolver.
 */

import type { ContentTemplate } from "@shared/schema";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function sectionText(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.name === "string") return record.name;
  }
  return "";
}

/** Declared variable names (accepts `"name"` or `{ name: "..." }`). */
export function declaredVariables(template: ContentTemplate): string[] {
  const out: string[] = [];
  for (const entry of template.variables ?? []) {
    if (typeof entry === "string") out.push(entry);
    else if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
      out.push((entry as { name: string }).name);
    }
  }
  return out;
}

/** Every placeholder appearing in the template structure. */
export function templatePlaceholders(template: ContentTemplate): string[] {
  const found = new Set<string>();
  for (const entry of template.structure ?? []) {
    const text = sectionText(entry);
    const re = new RegExp(PLACEHOLDER_RE.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      found.add(match[1]);
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return Array.from(found).sort();
}

/** Placeholders used but not declared — an explicit authoring error, not a silent drop. */
export function undeclaredVariables(template: ContentTemplate): string[] {
  const declared = new Set(declaredVariables(template));
  return templatePlaceholders(template).filter((name) => !declared.has(name));
}

export interface RenderedTemplate {
  sections: string[];
  /** Declared-but-unsupplied variables, rendered as `[missing: name]`. */
  missing: string[];
}

export function renderTemplateStructure(
  template: ContentTemplate,
  values: Readonly<Record<string, string>>,
): RenderedTemplate {
  const missing = new Set<string>();
  const sections = (template.structure ?? []).map((entry) => {
    const text = sectionText(entry);
    return text.replace(PLACEHOLDER_RE, (_all, name: string) => {
      const value = values[name];
      if (value === undefined || value === null || value === "") {
        missing.add(name);
        return `[missing: ${name}]`;
      }
      return value;
    });
  });
  return { sections, missing: Array.from(missing).sort() };
}
