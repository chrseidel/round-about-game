# Issue 4: the circle becomes a roundabout

**Status:** concept and decisions approved 2026-10-13 in [issue #4](https://github.com/chrseidel/round-about-game/issues/4) (mockups on the owner's private design canvas). Frontend only; rules, API and backend unchanged.

## Decisions

- Theme: a top-down roundabout. Cards are road signs around the ring, gaps are **exits**, the island carries the logo sign, the clue or the Tipster's secret number.
- Wording: keep Tipster, Guesser, lives, clue; gaps become "exits" in all copy.
- Background: grass with a subtle multi-colour gradient (sunlit yellow-green, faint warm glow, cool teal shade).
- The legacy single-browser prototype (`app.js`, `web/panel.ts`, `game.test.cjs`) is deleted; without a configured backend the page explains that a game server is missing.
- Overtime (decided here): hazard stripes (amber/ink) on the outer edge of the ring and an "Overtime" sign in the panel instead of cones.
- Cards stay evenly spaced around the ring (as today), not placed by number: up to 15 signs must stay legible on a phone.

## Screens

- **Entry (host/join):** grass, a large roundabout sign with the name, the form on a white sign card.
- **Lobby:** ring road with one car per player, driving counter-clockwise; name tags stay upright; the Tipster's car is yellow, your own tag is amber. Side (desktop) or bottom (phone): invite sign with copy button, Tipster sign with "Be the Tipster", traffic light with "Start game" (host) or who starts (others). Light is red until a Tipster and a Guesser are present, green when ready.
- **Game:** top bar with logo, "Draw N", a green "N cards to go" sign and New game. Ring with signs and exits; the island shows the logo, "Bob is thinking of a word", the clue sign, or (Tipster in clue time) the secret number on a yellow diamond. Panel: lives as cones (or the Overtime sign), heading, text, traffic-light timer, clue field, buttons.

## Motion

1. Lobby cars circle (48 s per lap).
2. Start: the lobby's light runs red, amber, green (~1.2 s) before the board appears, only for players who saw the lobby.
3. Reveal: during the shared 2 s build-up a car drives at least one lap from the locked exit and leaves by the correct exit exactly at `revealAtUtc`.
4. A lost life tips a cone over.

`prefers-reduced-motion`: no car motion, no start sequence delay, no reveal drive; the existing reveal bar is hidden as today.

## Testable pieces

- `turnView` copy (exits), `lobbyView` (cars, Tipster sign, light, start hint for everyone), `islandView`, `exitLabel`, `correctExit` (index of the correct exit in the pre-reveal circle).
- Accessibility: exits are buttons named "Exit between 33 Lighthouse and 66 Glacier"; focus ring; contrast ≥ 4.5:1 for body text.
