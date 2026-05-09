const BOLD_LOWER_START = 0x1d41a;
const BOLD_UPPER_START = 0x1d400;
const ITALIC_LOWER_START = 0x1d44e;
const ITALIC_UPPER_START = 0x1d434;
const MONO_LOWER_START = 0x1d68a;
const MONO_UPPER_START = 0x1d670;

function charOffset(char: string, lowerStart: number, upperStart: number): string {
  const code = char.charCodeAt(0);
  if (code >= 97 && code <= 122) return String.fromCodePoint(lowerStart + code - 97);
  if (code >= 65 && code <= 90) return String.fromCodePoint(upperStart + code - 65);
  return char;
}

function chars(text: string): string[] {
  return Array.from(text);
}

export function toBold(text: string): string {
  return chars(text).map((c) => charOffset(c, BOLD_LOWER_START, BOLD_UPPER_START)).join("");
}
export function toItalic(text: string): string {
  return chars(text).map((c) => charOffset(c, ITALIC_LOWER_START, ITALIC_UPPER_START)).join("");
}
export function toMonospace(text: string): string {
  return chars(text).map((c) => charOffset(c, MONO_LOWER_START, MONO_UPPER_START)).join("");
}
export function toStrikethrough(text: string): string {
  return chars(text).map((c) => c + "\u0336").join("");
}

export const FORMATS = {
  bold: toBold,
  italic: toItalic,
  monospace: toMonospace,
  strikethrough: toStrikethrough,
} as const;
export type FormatKey = keyof typeof FORMATS;
