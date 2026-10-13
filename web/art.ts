/** Inline SVG artwork shared by the entry, lobby and game screens. */

/** The blue roundabout road sign: three white arrows driving counter-clockwise. */
export const SIGN_SVG =
  '<svg class="roundabout-sign" viewBox="-92 -92 184 184" aria-hidden="true">' +
  '<circle r="84" fill="#1F56B3" stroke="#F3F1E8" stroke-width="8"/>' +
  '<g fill="none" stroke="#F3F1E8" stroke-width="12">' +
  [0, 120, 240]
    .map(
      (turn) =>
        `<path d="M 41.4 7.3 A 42 42 0 0 0 16.5 -38.6" transform="rotate(${turn})"/>`,
    )
    .join("") +
  '</g><g fill="#F3F1E8">' +
  [0, 120, 240]
    .map(
      (turn) =>
        `<polygon points="1.2,-44.3 18.4,-50.7 10.3,-28.2" transform="rotate(${turn})"/>`,
    )
    .join("") +
  "</g></svg>";

/** A top-down car facing left (counter-clockwise on the ring). */
export function carSvg(color: string, tipster = false): string {
  const roof = tipster
    ? '<rect x="20" y="7" width="11" height="12" rx="2" fill="#16202A"/><rect x="21.5" y="8.5" width="8" height="9" rx="1" fill="#FFB81C"/>'
    : "";
  return (
    '<svg class="car-svg" viewBox="0 0 46 26" aria-hidden="true">' +
    `<rect x="1" y="1" width="44" height="24" rx="8" fill="${color}" stroke="#16202A" stroke-width="2"/>` +
    '<rect x="9" y="4" width="8" height="18" rx="2" fill="#16202A" opacity=".75"/>' +
    '<rect x="34" y="5" width="5" height="16" rx="2" fill="#16202A" opacity=".55"/>' +
    roof +
    "</svg>"
  );
}

/** A traffic cone, one per life. */
export const CONE_SVG =
  '<svg class="cone-svg" viewBox="0 0 30 36" aria-hidden="true">' +
  '<path d="M11 2h8l8 28H3z" fill="currentColor" stroke="#16202A" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M8 14h14M5.5 22h19" stroke="#F3F1E8" stroke-width="4"/>' +
  '<rect x="0" y="30" width="30" height="5" rx="2" fill="#16202A"/></svg>';

/** Two chevrons pointing out of an exit. */
export const CHEVRONS_SVG =
  '<svg class="chevrons" viewBox="0 0 30 34" aria-hidden="true">' +
  '<path d="M5 20 L15 10 L25 20 M5 31 L15 21 L25 31" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Car colours by join order; the Tipster always drives the yellow one. */
export const CAR_COLORS = [
  "#D8402F",
  "#19A39A",
  "#7A4FD0",
  "#2C6FD6",
  "#E0812B",
  "#C2417F",
  "#5B6B7A",
  "#8DB33A",
];
export const TIPSTER_CAR = "#FFB81C";
