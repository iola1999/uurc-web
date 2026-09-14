import { describe, expect, it } from "vitest";

import { redactSignalEventPayload } from "../src/redact.js";

describe("redactSignalEventPayload", () => {
  it("redacts sensitive keys but keeps routing and transport fields readable", () => {
    const payload = [
      "success",
      {
        client_id: "controlled-1",
        force_relay: true,
        relay_ins_type: 3,
        iceServers: [
          { urls: "turn:relay.example:3478?transport=udp", username: "turn-user", credential: "turn-pass" },
          { urls: "stun:stun.example:3478" },
        ],
        streamer_data: '{"sdp":"v=0..."}',
      },
    ];
    expect(redactSignalEventPayload(payload)).toEqual([
      "success",
      {
        client_id: "controlled-1",
        force_relay: true,
        relay_ins_type: 3,
        iceServers: [
          {
            urls: "turn:relay.example:3478?transport=udp",
            username: "<redacted len=9>",
            credential: "<redacted len=9>",
          },
          { urls: "stun:stun.example:3478" },
        ],
        streamer_data: '{"sdp":"v=0..."}',
      },
    ]);
  });

  it("matches sensitive keys case-insensitively and truncates runaway nesting", () => {
    expect(redactSignalEventPayload({ Authorization: "Bearer x" })).toEqual({ Authorization: "<redacted len=8>" });
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 12; depth += 1) nested = { next: nested };
    const result = JSON.stringify(redactSignalEventPayload(nested));
    expect(result).toContain("<truncated depth>");
    expect(result.length).toBeLessThan(400);
  });
});
