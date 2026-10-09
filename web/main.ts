// Keep the existing browser game playable while the rule engine moves to game/.
import "../app.js";
import {
  SessionApi,
  normalizeCode,
  rememberParticipant,
  storedParticipant,
} from "./session-api.ts";

// Keep the local prototype usable until the multiplayer board is wired up.
async function setupSessionEntry() {
  let endpoint: string | undefined;
  try {
    const response = await fetch("/amplify_outputs.json");
    if (response.ok)
      endpoint = (
        (await response.json()) as { custom?: { gameApiUrl?: string } }
      ).custom?.gameApiUrl;
  } catch {
    /* no sandbox configured */
  }
  if (!endpoint) return;

  const api = new SessionApi({ gameApiUrl: endpoint });
  const entry = document.querySelector<HTMLDivElement>("#sessionEntry")!;
  entry.hidden = false;
  const squid = location.pathname.startsWith("/s/")
    ? location.pathname.slice(3)
    : "";
  const saved = squid && storedParticipant(squid);
  const nickname = localStorage.getItem("one-round:nickname") ?? "";
  entry.innerHTML = `<form id="sessionForm"><h1>One Round</h1><label>Nickname <input id="nickname" maxlength="24" required /></label><label>Session code <input id="sessionCode" placeholder="Code or invitation link" /></label><div class="session-actions"><button type="submit" name="action" value="host">Host session</button><button type="submit" name="action" value="join">Join session</button></div><p id="sessionError" role="alert"></p></form>`;
  (entry.querySelector("#nickname") as HTMLInputElement).value = nickname;
  (entry.querySelector("#sessionCode") as HTMLInputElement).value = squid;
  if (saved) {
    try {
      await api.snapshot(squid, saved.token);
      entry.textContent = `Joined session ${squid}. Multiplayer board is under construction.`;
      return;
    } catch {
      sessionStorage.removeItem(`one-round:${squid}`);
    }
  }
  entry
    .querySelector<HTMLFormElement>("#sessionForm")!
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement;
      const name = (
        entry.querySelector("#nickname") as HTMLInputElement
      ).value.trim();
      const message = entry.querySelector<HTMLElement>("#sessionError")!;
      message.textContent = "";
      try {
        const grant =
          submitter.value === "host"
            ? await api.host(name)
            : await api.join(
                normalizeCode(
                  (entry.querySelector("#sessionCode") as HTMLInputElement)
                    .value,
                ),
                name,
              );
        localStorage.setItem("one-round:nickname", name);
        rememberParticipant(grant.snapshot.squid, grant);
        history.replaceState(null, "", `/s/${grant.snapshot.squid}`);
        entry.textContent = `Joined session ${grant.snapshot.squid}. Share this URL with friends. Multiplayer board is under construction.`;
      } catch (error) {
        message.textContent = (error as Error).message;
      }
    });
}

void setupSessionEntry();
