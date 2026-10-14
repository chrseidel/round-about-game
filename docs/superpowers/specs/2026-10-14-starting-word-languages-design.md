# Starting-word languages (English / German)

**Status:** approved 2026-10-14 (owner: "go with your recommendations"). First step of making the game multilingual; the interface itself stays English for now.

## Decisions

- **The host chooses on the start screen:** a two-button toggle "English / Deutsch" under "Starting words for a new game", preset from the last choice (`localStorage` `round-about:language`) or the browser language. The three starting words are drawn when the game is created. "New game" keeps the language.
- **Word lists:** about 1,000+ words per language (`amplify/functions/game-api/words-en.ts`, `words-de.ts`). Single, everyday, family-friendly nouns from many areas; no proper names or brands. German nouns capitalised as usual, English with a capital first letter. Tests enforce at least 1,000 entries, no duplicates (ignoring case), and that each entry is a valid one-word clue of 3–14 letters.
- **Data:** `Session.language` (`"en" | "de"`), projected as `PublicSnapshot.language`. Sessions created before this change count as English. `POST /sessions` accepts `language` (default `en`); anything else is rejected with "Choose English or Deutsch for the starting words."
- **Lobby:** shows "Starting words: Deutsch/English" in the Tipster window.

## Out of scope

Translating the interface, clue validation per language (the clue check already accepts umlauts and ß), choosing the language in the lobby.
