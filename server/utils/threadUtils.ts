/**
 * Appends "N/total" to the end of each tweet in a multi-tweet thread.
 * Single tweets are returned unchanged. Idempotent — already-numbered tweets are skipped.
 * If appending would exceed 280 chars, the tweet body is fitted to the budget at a
 * boundary a reader accepts, and marked with an ellipsis when it is a word cut.
 *
 * Run 58: this used to `trimmed.slice(0, maxBody)` — a bare offset cut, so the
 * transport itself silently destroyed the last word of any body that ran long, at
 * exactly the same 280 bound as the generation sites in `autopilot.ts` and
 * `routes.ts`. Measured on the live table: 26 of 184 stored units sat at exactly
 * 280 chars ending mid-word, 22 of them in `posted` rows. A validator downstream
 * of this point (D24 / `xTextLimits`) cannot see it, because a cut unit is by
 * definition within budget.
 */
import { fitUnitToBudget } from "../content/unitFit";

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
    // Fit the body into the budget the suffix leaves, at a boundary the reader accepts.
    const maxBody = 280 - num.length - 2; // 2 = "\n\n"
    const fitted = fitUnitToBudget(trimmed, maxBody);
    return `${fitted.text}\n\n${num}`;
  });
}
