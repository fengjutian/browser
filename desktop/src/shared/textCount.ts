/**
 * Counts readable units for mixed CJK/Latin text. Each CJK character counts as
 * one unit, while a contiguous Latin/number token counts as one word.
 * Punctuation and Markdown syntax do not increase the count.
 */
export function countTextUnits(text: string): number {
  if (!text.trim()) return 0
  const units = text.normalize('NFKC').match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)
  return units?.length ?? 0
}
