import { describe, expect, it } from "vitest";

import type { RemoteSignalGatewayEvent } from "@uurc/shared/signalGateway/model";
import { STREAMER_ICE_NETWORK_TYPES } from "@uurc/shared/streamer/signalSoac";
import { BrowserRemoteSession } from "../src/remote/browserRemoteSession.js";
import { FakePeerConnection, FakeRemoteApi, soacEvent } from "./browserRemoteSessionTestHarness.js";

describe("BrowserRemoteSession signal recovery", () => {
  it("ignores inbound SOAC answers that do not belong to the current App control session", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });
    await session.start({
      appControlId: "control-1",
      iceId: "ice-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    await session.applySignalEvents([
      soacEvent(1, {
        client_id: "controlled-2",
        data: {
          type: "answer",
          app_control_id: "control-2",
          ice_id: "ice-2",
          sdp: "v=0 stale answer",
        },
      }),
      soacEvent(2, {
        client_id: "controlled-1",
        data: {
          type: "answer",
          app_control_id: "control-1",
          ice_id: "ice-1",
          sdp: "v=0 controlled answer",
        },
      }),
    ]);

    expect(peer.remoteDescriptions).toEqual([{ type: "answer", sdp: "v=0 controlled answer" }]);
    expect(session.getState().stage).toBe("connected");
  });

  it("ignores inbound SOAC candidates scoped to another ICE connection", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });
    await session.start({
      appControlId: "control-1",
      iceId: "ice-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    await session.applySignalEvents([
      soacEvent(1, {
        client_id: "controlled-1",
        data: {
          type: "answer",
          app_control_id: "control-1",
          ice_id: "ice-1",
          sdp: "v=0 controlled answer",
        },
      }),
      soacEvent(2, {
        client_id: "controlled-1",
        data: {
          type: "candidate",
          app_control_id: "control-1",
          ice_id: "ice-2",
          candidate: {
            candidate: "candidate:stale 1 udp 1 192.168.1.9 10001 typ host",
            sdpMid: "0",
            sdpMLineIndex: 0,
          },
        },
      }),
      soacEvent(3, {
        client_id: "controlled-1",
        data: {
          type: "candidate",
          app_control_id: "control-1",
          ice_id: "ice-1",
          candidate: {
            candidate: "candidate:current 1 udp 1 192.168.1.2 10000 typ host",
            sdpMid: "0",
            sdpMLineIndex: 0,
          },
        },
      }),
    ]);

    expect(peer.candidates).toEqual([
      {
        candidate: "candidate:current 1 udp 1 192.168.1.2 10000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    ]);
  });

  it("does not reapply already processed SOAC events during polling", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });
    const events = [
      soacEvent(2, {
        client_id: "controlled-1",
        data: {
          type: "answer",
          sdp: "v=0 controlled answer",
        },
      }),
    ];

    await session.applySignalEvents(events);
    await session.applySignalEvents(events);

    expect(peer.remoteDescriptions).toEqual([{ type: "answer", sdp: "v=0 controlled answer" }]);
  });

  it("applies inbound SOAC restart_ice as an App remote answer", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
      gzipSdp: false,
    });

    await session.applySignalEvents([
      soacEvent(2, {
        client_id: "controlled-1",
        data: {
          type: "restart_ice",
          sdp: "v=0 controlled restart answer",
          ice_network_type: STREAMER_ICE_NETWORK_TYPES.v4Wlan,
        },
      }),
    ]);

    expect(peer.restartIceCalls).toBe(0);
    expect(peer.createOfferCalls).toEqual([undefined]);
    expect(peer.remoteDescriptions).toEqual([{ type: "answer", sdp: "v=0 controlled restart answer" }]);
    expect(api.soacCalls).toHaveLength(1);
    expect(session.getState().stage).toBe("connected");
  });

  it("ignores stale SOAC answers when the peer is no longer in have-local-offer", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    await session.applySignalEvents([
      soacEvent(1, {
        client_id: "controlled-1",
        data: { type: "answer", sdp: "v=0 controlled answer" },
      }),
    ]);
    expect(peer.signalingState).toBe("stable");

    await session.applySignalEvents([
      soacEvent(2, {
        client_id: "controlled-1",
        data: { type: "answer", sdp: "v=0 stale controlled answer" },
      }),
    ]);

    expect(peer.remoteDescriptions).toEqual([{ type: "answer", sdp: "v=0 controlled answer" }]);
    const debugEvents = session.getState().debugEvents;
    expect(
      debugEvents.some((event) => event.kind === "signal" && event.summary === "忽略状态不匹配的 SOAC answer"),
    ).toBe(true);
  });

  it("records a debug event when setRemoteDescription rejects instead of throwing", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    peer.setRemoteDescriptionShouldThrow = true;

    await expect(
      session.applySignalEvents([
        soacEvent(1, {
          client_id: "controlled-1",
          data: { type: "answer", sdp: "v=0 controlled answer" },
        }),
      ]),
    ).resolves.toBeUndefined();

    expect(peer.remoteDescriptions).toEqual([]);
    expect(session.getState().stage).not.toBe("connected");
    const debugEvents = session.getState().debugEvents;
    expect(debugEvents.some((event) => event.kind === "signal" && event.summary === "应用 SOAC answer 失败")).toBe(
      true,
    );
  });

  it("handles App switch_network_notify by sending one restart_ice offer for the same ICE connection", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });
    peer.offerSdp = [
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 107",
      "a=rtpmap:107 opus/48000/2",
      "a=fmtp:107 minptime=10;useinbandfec=1",
    ].join("\r\n");

    const events = [
      {
        id: 10,
        direction: "inbound",
        event: "switch_network_notify",
        receivedAt: "2026-05-15T00:00:01.000Z",
        payload: [{ transport_type: STREAMER_ICE_NETWORK_TYPES.appAuto, attempt_switch_type: 2, ice_id: "ice-1" }],
      } satisfies RemoteSignalGatewayEvent,
    ];

    await session.applySignalEvents(events);
    await session.applySignalEvents(events);

    expect(peer.restartIceCalls).toBe(1);
    expect(peer.createOfferCalls).toEqual([undefined, { iceRestart: true }]);
    expect(api.soacCalls.at(-1)).toMatchObject({
      type: "restart_ice",
      clientId: "controlled-1",
      iceId: "ice-1",
      appControlId: "control-1",
      sdp: [
        "v=0",
        "m=audio 9 UDP/TLS/RTP/SAVPF 107",
        "a=rtpmap:107 opus/48000/2",
        "a=fmtp:107 minptime=10;stereo=1;useinbandfec=1;maxplaybackrate=48000;maxaveragebitrate=128000",
      ].join("\r\n"),
      gzipSdp: true,
      iceNetworkType: STREAMER_ICE_NETWORK_TYPES.appAuto,
    });
  });

  it("can send a plain-SDP offer for streamer compatibility testing", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });

    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
      gzipSdp: false,
    });

    expect(api.controlCalls).toEqual([
      {
        appControlId: "control-1",
        appDataBase64: "Cg==",
        streamerData: "{}",
      },
    ]);
    expect(api.soacCalls[0]).toMatchObject({
      type: "offer",
      sdp: "v=0 browser offer",
      gzipSdp: false,
    });
  });

  it("can force the browser WebRTC path through relay candidates", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });

    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
      forceRelay: true,
    });

    expect(peer.configuration).toMatchObject({
      iceTransportPolicy: "relay",
    });
  });

  it("uses relay when the signal service requires relay", async () => {
    const api = new FakeRemoteApi({
      forceRelay: true,
    });
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });

    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    expect(peer.configuration).toMatchObject({
      iceTransportPolicy: "relay",
    });
    expect(session.getState().controlResult?.forceRelay).toBe(true);
  });

  it("still lets the operator explicitly force relay candidates", async () => {
    const api = new FakeRemoteApi({
      forceRelay: true,
    });
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
    });

    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
      forceRelay: true,
    });

    expect(peer.configuration).toMatchObject({
      iceTransportPolicy: "relay",
    });
  });
});
