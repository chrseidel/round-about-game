import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@smithy/signature-v4";
import type { PublicEvent } from "../../../shared/protocol.ts";

export async function publishEvent(squid: string, event: PublicEvent) {
  const endpoint = process.env.EVENTS_URL;
  if (!endpoint) throw new Error("Event endpoint missing");
  const url = new URL(endpoint);
  const body = JSON.stringify({
    channel: `/games/${squid}`,
    events: [JSON.stringify(event)],
  });
  const signer = new SignatureV4({
    service: "appsync",
    region: process.env.AWS_REGION!,
    credentials: defaultProvider(),
    sha256: Sha256,
  });
  const signed = await signer.sign({
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    method: "POST",
    headers: { host: url.hostname, "content-type": "application/json" },
    body,
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: signed.headers,
    body,
  });
  if (!response.ok) throw new Error(`Event publish failed: ${response.status}`);
}
