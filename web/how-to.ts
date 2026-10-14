import { CONE_SVG, DIAMOND_SVG, SIGN_SVG, TROPHY_SVG, sideCar } from "./art.ts";

/**
 * The "How to play" window on the start screen. The rules stay off the game
 * screens (see AGENTS.md); this is the one place they are written out. The
 * two pictures are screenshots of the real phone views in public/how-to/;
 * retake them when the game's look changes.
 */
export const HOW_TO_HTML =
  '<div class="how-to-head"><h2 id="howToTitle">How to play</h2>' +
  '<button class="how-to-close" type="button" aria-label="Close" data-close>×</button></div>' +
  '<div class="how-to-body">' +
  `<section><span class="how-to-icon">${SIGN_SVG}</span><div><h3>The goal</h3>` +
  "<p>Together, place 12 numbered cards on the roundabout, each in its right gap. Every card on the ring has a number from 0/100 to 99 and a word.</p></div></section>" +
  `<section><span class="how-to-icon">${sideCar("#E04848")}</span><div><h3>Before you start</h3>` +
  "<p>One player hosts and shares the invite link; everyone joins with a nickname. One player takes the <strong>Tipster</strong> seat for the whole game. Everyone else is a <strong>Guesser</strong>.</p></div></section>" +
  `<section><span class="how-to-icon">${DIAMOND_SVG}</span><div><h3>Each turn</h3>` +
  "<p>The Tipster draws a secret number from 1 to 99 that only they can see, and has <strong>20 seconds</strong> (plus 3) to send <strong>one word</strong> that links the words on either side of where the number belongs.</p>" +
  "<p>The Guessers talk it over, <strong>tap an exit</strong> to suggest it, and <strong>tap it again</strong> to lock it in. Everyone sees the result at the same moment.</p></div></section>" +
  '<div class="how-to-views">' +
  '<figure><img src="/how-to/tipster.webp" width="1115" height="615" loading="lazy" alt="The Tipster\'s screen: the secret number 46 on a yellow sign in the middle of the roundabout, marked Only you can see it; in the panel, the clue timer at 0:14 and the word Harbor typed in, ready to send." />' +
  "<figcaption><strong>Tipster:</strong> only you see the number. Type one word and send it before the timer runs out.</figcaption></figure>" +
  '<figure><img src="/how-to/guesser.webp" width="1115" height="615" loading="lazy" alt="A Guesser\'s screen: Tia\'s clue Harbor on the island, and the exit between 33 Camel and 66 Bargain marked with yellow arrows; the panel says Pick the exit." />' +
  "<figcaption><strong>Guesser:</strong> read the clue, tap an exit to suggest it (yellow arrows), then tap it again to lock it in.</figcaption></figure>" +
  "</div>" +
  `<section><span class="how-to-icon how-to-cone">${CONE_SVG}</span><div><h3>Lives</h3>` +
  "<p>A wrong exit still puts the card in its correct gap but costs one of <strong>three lives</strong>. No clue in time discards the card and costs a life too. After the third lost life comes <strong>Overtime</strong>: one more miss ends the game.</p></div></section>" +
  `<section><span class="how-to-icon">${TROPHY_SVG}</span><div><h3>Winning</h3>` +
  "<p>Place the last card of the pile correctly and you win, even in Overtime.</p></div></section>" +
  '<section class="how-to-rule"><div><h3>Clue rules</h3>' +
  "<p>One word (or a proper name), not already on the roundabout. No numbers and no hints about positions; the group judges the rest.</p></div></section>" +
  '<button class="button primary" type="button" data-close>Got it</button>' +
  "</div>";

/** Opens the window; closes on its buttons, Esc, or a tap beside it. */
export function setupHowTo(dialog: HTMLDialogElement) {
  if (!dialog.innerHTML) dialog.innerHTML = HOW_TO_HTML;
  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target === dialog || target.closest("[data-close]")) dialog.close();
  });
  return () => dialog.showModal();
}
