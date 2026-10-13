/**
 * Hesitations as the model spells them: uh, um, erm, hmm, mmm, and the
 * Russian э, эм, хм, ммм, stretched (ээээ) or hyphenated (э-э-э, а-а).
 * Two m's stay, since mm and мм are millimetres.
 */
const HESITATION =
  /^(?:u+h+|u+m+|e+r+m+|h+m+|m{3,}|э+м*|х+м+|м{3,}|(\p{L})(?:-\1)+)$/u;
const STOP = /[.!?…]+$/u;

function isHesitation(word: string): boolean {
  const letters = word.replace(/^\P{L}+|\P{L}+$/gu, "");
  // An acronym such as UM or UH.
  if (letters.length > 1 && letters === letters.toUpperCase()) return false;
  const bare = letters.toLowerCase();
  // "um" is also a Portuguese and German word: a hesitation only when a comma
  // or a stop sets it off.
  if (bare === "um") return /[,.!?…]$/u.test(word);
  return HESITATION.test(bare);
}

const capitalized = (word: string) =>
  word.replace(/\p{L}/u, (letter) => letter.toUpperCase());

/**
 * The text without hesitations. A sentence that began with one starts with a
 * capital again, and one that ended on one ends on the word before it. Where
 * the model wrote a hesitation as a period and went on ("item.," before
 * "да"), the comma stays.
 */
export function stripHesitations(text: string): string {
  const kept: string[] = [];
  let capitalize = false;
  const words = text
    .replace(/(?<=(?:^|\s)[^\s.]{4,})\.(?=,)/gu, "")
    .split(/\s+/u);
  for (const word of words.filter(Boolean)) {
    if (!isHesitation(word)) {
      kept.push(capitalize ? capitalized(word) : word);
      capitalize = false;
      continue;
    }
    const previous = kept.at(-1);
    if (previous === undefined || STOP.test(previous)) {
      capitalize ||= /\p{Lu}/u.test(word);
      continue;
    }
    const stop = word.match(STOP)?.[0];
    if (stop) kept[kept.length - 1] = previous.replace(/,$/u, "") + stop;
  }
  // A take of hesitations alone stays as it was: BB reports empty text as a
  // failure.
  return kept.length > 0 ? kept.join(" ") : text;
}
