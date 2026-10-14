import { randomBytes } from "node:crypto";
import type { Language } from "../../../shared/protocol.ts";
import { WORDS_DE } from "./words-de.ts";
import { WORDS_EN } from "./words-en.ts";

export const LANGUAGES: Language[] = ["en", "de"];

/** Starting words per language: single, everyday, family-friendly nouns. */
export const STARTING_WORDS: Record<Language, string[]> = {
  en: WORDS_EN,
  de: WORDS_DE,
};

/** Three different starting words, drawn at random from the language's list. */
export function startingWords(language: Language): string[] {
  const words = STARTING_WORDS[language];
  const picked: string[] = [];
  while (picked.length < 3) {
    const word = words[randomBytes(4).readUInt32BE() % words.length]!;
    if (!picked.some((other) => other.toLowerCase() === word.toLowerCase()))
      picked.push(word);
  }
  return picked;
}
