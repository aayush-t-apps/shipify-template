// Placeholder logic for the tool preset. Replace with the app's real transformation.
export interface TextStats {
  characters: number;
  words: number;
  lines: number;
}

export function textStats(text: string): TextStats {
  const trimmed = text.trim();
  return {
    characters: text.length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    lines: text ? text.split("\n").length : 0,
  };
}
