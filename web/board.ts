type Card = { number: number; word: string };
type BoardState = {
  cards: Card[];
  phase: string;
  selectedGap: number | null;
  recent: number | null;
  clue: string;
  pile: number;
};

const $ = (selector: string) =>
  document.querySelector(selector)! as HTMLElement;

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

export function renderBoard(
  state: BoardState,
  selectGap?: (index: number) => void,
) {
  const ring = $("#ringCards");
  const board = $("#board");
  ring.replaceChildren();
  const count = state.cards.length;
  const radius = Math.min(
    board.clientHeight * 0.39,
    (board.clientWidth - 84) / 2,
  );
  state.cards.forEach((cardData, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    const card = document.createElement("div");
    card.className = `ring-card ${[0, 33, 66].includes(cardData.number) ? "is-anchor" : ""} ${state.recent === cardData.number ? "is-recent" : ""}`;
    card.classList.toggle("compact", count > 9);
    card.innerHTML = `<span class="ring-number">${cardData.number === 0 ? "0/100" : cardData.number}</span><span class="ring-word">${escapeHtml(cardData.word)}</span>`;
    card.style.left = `calc(50% + ${Math.cos(angle) * radius}px)`;
    card.style.top = `calc(50% + ${Math.sin(angle) * radius}px)`;
    ring.append(card);

    const gapAngle = angle + Math.PI / count;
    const gap = document.createElement("button");
    gap.type = "button";
    gap.className = `ring-gap ${state.selectedGap === index ? "selected" : ""}`;
    gap.textContent = state.selectedGap === index ? "⌛" : "+";
    gap.title = `Between ${cardData.word} and ${state.cards[(index + 1) % count]!.word}`;
    gap.setAttribute("aria-label", gap.title);
    gap.disabled = !selectGap || state.phase !== "guess";
    const gapRadius = radius + (board.clientWidth < 360 ? 23 : 29);
    gap.style.left = `calc(50% + ${Math.cos(gapAngle) * gapRadius}px)`;
    gap.style.top = `calc(50% + ${Math.sin(gapAngle) * gapRadius}px)`;
    if (selectGap) gap.addEventListener("click", () => selectGap(index));
    ring.append(gap);
  });

  $("#boardMessage").innerHTML =
    state.phase === "guess"
      ? `“${escapeHtml(state.clue.trim())}”`
      : "Find the<br /><em>connection.</em>";
  $("#boardSubline").textContent =
    state.phase === "guess" ? "Choose a gap" : "";
  $("#pileCount").textContent =
    `${state.pile} ${state.pile === 1 ? "CARD" : "CARDS"} LEFT`;
}
