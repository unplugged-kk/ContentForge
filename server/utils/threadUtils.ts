/**
 * Appends "N/total" to the end of each tweet in a multi-tweet thread.
 * Single tweets are returned unchanged. Idempotent — already-numbered tweets are skipped.
 * If appending would exceed 280 chars, the tweet body is trimmed to fit.
 */
export function addThreadNumbering(tweets: string[]): string[] {
  if (tweets.length <= 1) return tweets;
  const total = tweets.length;
  return tweets.map((text, i) => {
    const trimmed = text.trim();
    // Already numbered — skip
    if (/\n\n\d+\/\d+\s*$/.test(trimmed)) return trimmed;
    const num = `${i + 1}/${total}`;
    const withNum = `${trimmed}\n\n${num}`;
    if (withNum.length <= 280) return withNum;
    // Trim body to fit within 280
    const maxBody = 280 - num.length - 2; // 2 = "\n\n"
    return `${trimmed.slice(0, maxBody)}\n\n${num}`;
  });
}
