# Issue 4: the circle becomes a roundabout

**Status:** concept and decisions approved 2026-10-13 in [issue #4](https://github.com/chrseidel/round-about-game/issues/4) (mockups on the owner's private design canvas). Frontend only; rules, API and backend unchanged. The design went through three rounds: a flat street-sign roundabout, then 8-bit isometric everywhere, then the final split below, because the isometric game board could not show 18 readable signs without covering exits.

## Decisions

- **One pixel world, two camera views.** Entry and lobby look at an isometric diorama (grass block with dirt sides, side roads, trees, banded sky). When the game starts, players who watched the lobby see the camera swing overhead (lights 1.3 s, camera 1.8 s); reloads and late joins start top-down. Reduced motion cuts straight to the board.
- **One projection.** Everything on the ground is laid out top-down in ground units and drawn through `project(camera, x, y)` (rotation, scale, tilt, oval stretch). Upright things (signs, cars, name tags, trees) stand at their projected foot point. The camera move interpolates the camera's settings.
- **Exits:** short roads between signs with a give-way line; the suggested exit blinks with chevrons; two taps lock, as before. Real buttons with names like "Exit between 33 Lighthouse and 66 Glacier".
- **Signs never cover exits:** they stand just beyond the exits' ends, anchored by the edge nearest the ring.
- **Capacity:** up to 18 cards (3 starting + 12 pile + 3 replacement draws after wrong guesses on the last card). The camera is fitted to the board region and card count: full-size signs if they fit, compact ones otherwise; as a last resort staggered signs (desktop) or extra board height so the page scrolls (phones). The scene measures the drawn signs and escalates if they still collide.
- **Desktop and tablets: the ring is always a perfect circle** (owner's requirement, 2026-10-14). When 18 signs crowd a small circle, every other sign stands further out (staggered) instead of the ring stretching. Portrait tablets put the panel below the board so the circle gets the width.
- **Phones:** the ring becomes a tall oval; the island is too narrow for text, so the secret number and the clue show in the panel.
- **Look:** Press Start 2P (logo, numbers, headings, buttons) and Pixelify Sans (text); limited palette (ink `#1B1A2E`, paper `#F2F0E6`, grass `#5DBB63`, asphalt `#4A4E69`, sign blue `#3366CC`, amber `#FFC845`, cone `#FF7A2F`, kerb `#E04848`); square pixel windows with hard shadows; crisp edges.
- **Wording:** Tipster, Guesser, lives and clue stay; gaps are "exits".
- The legacy single-browser prototype is removed; without a backend the page says that no game server is configured.
- Overtime: hazard stripes on the ring's edge and the panel header.

## Motion

Lobby cars circle (40 s per lap); start: traffic light, windows step away, camera move; reveal: a top-down car laps the ring during the 2 s build-up and leaves by the correct exit; a lost life tips a cone. All skipped with reduced motion.

## Verification record

- Unit tests (`web/camera.test.ts`): projection, interpolation, arc-length spacing, fitting for 3/12/18 cards on desktop and phone boards with no overlapping signs.
- Sandbox, three players (desktop host, phone Tipster, desktop Guesser): entry, lobby, camera move on the phone, draw with the secret in the phone panel, clue, two-tap exit, reveal, reload into the top-down view, Overtime state. 18 cards measured in the running app at 1024 × 768 and 375 × 812: 0 overlapping signs, 0 signs off screen, 0 covered exits, exits ≥ 56 px apart on the phone.
