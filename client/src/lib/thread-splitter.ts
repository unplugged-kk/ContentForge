/** Split long text into tweet-sized chunks on sentence / paragraph boundaries. */
export function splitIntoThread(text: string, charLimit = 280): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= charLimit) return [trimmed];

  const sentences = trimmed.split(/(?<=[.!?])\s+|\n\n+/);
  const tweets: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= charLimit) {
      current = candidate;
    } else {
      if (current) tweets.push(current.trim());
      current = sentence.length <= charLimit ? sentence : sentence.slice(0, charLimit);
    }
  }
  if (current) tweets.push(current.trim());
  return tweets.filter(Boolean);
}
