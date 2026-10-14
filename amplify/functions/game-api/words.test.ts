import test from "node:test";
import assert from "node:assert/strict";
import { clueError } from "../../../game/rules.ts";
import { LANGUAGES, STARTING_WORDS, startingWords } from "./words.ts";

for (const language of LANGUAGES) {
  const words = STARTING_WORDS[language];

  test(`${language}: a very big list of starting words`, () => {
    assert.ok(words.length >= 1000, `${words.length} words`);
  });

  test(`${language}: no duplicates, ignoring case`, () => {
    const seen = new Map<string, string>();
    const duplicates = words.filter((word) => {
      const key = word.toLocaleLowerCase(language);
      if (seen.has(key)) return true;
      seen.set(key, word);
      return false;
    });
    assert.deepEqual(duplicates, []);
  });

  test(`${language}: every entry is one capitalised word a clue could be`, () => {
    const invalid = words.filter(
      (word) =>
        clueError(word, []) !== "" ||
        word[0] !== word[0]!.toLocaleUpperCase(language) ||
        word.length < 3 ||
        word.length > 14,
    );
    assert.deepEqual(invalid, []);
  });
}

test("three different starting words from the chosen language", () => {
  for (const language of LANGUAGES) {
    for (let i = 0; i < 50; i++) {
      const picked = startingWords(language);
      assert.equal(picked.length, 3);
      assert.equal(new Set(picked.map((w) => w.toLowerCase())).size, 3);
      for (const word of picked)
        assert.ok(STARTING_WORDS[language].includes(word), word);
    }
  }
});
