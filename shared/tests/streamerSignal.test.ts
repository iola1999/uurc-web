import { describe, expect, it } from "vitest";

import {
  STREAMER_CONTROLLER_SIGNAL_EVENTS,
  STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS,
  STREAMER_CONTROL_EVENT_NAME,
  buildStreamerSignalHeaders,
  STREAMER_SIGNAL_SOCKET_EVENTS,
} from "../src/streamer/signalSession.js";
import {
  STREAMER_CONTROLLER_INBOUND_SOAC_TYPES,
  STREAMER_ICE_NETWORK_TYPES,
  STREAMER_SOAC_EVENT,
  STREAMER_SOAC_TYPES,
  buildStreamerSoacPayload,
} from "../src/streamer/signalSoac.js";
import { buildStreamerRtcConfiguration, normalizeStreamerSignalControlAck } from "../src/streamer/signalControl.js";
import {
  STREAMER_CLIENT_VERSION,
  STREAMER_CONTROLLER_OUTBOUND_SOAC_TYPES,
  STREAMER_CONTROL_EVENT_PAYLOAD_KEYS,
  STREAMER_CONTROL_EVENT_PAYLOAD_TYPES,
  STREAMER_CONTROL_EVENT_WIRE_ARGUMENT_ORDER,
  STREAMER_CONTROL_RESULT_ICE_SERVER_KEYS,
  STREAMER_CONTROL_RESULT_KEYS,
  STREAMER_DEFAULT_SIGNAL_HEADER_VALUES,
  STREAMER_SIGNAL_HEADER_KEYS,
  STREAMER_SOAC_MESSAGE_KEYS,
  STREAMER_SOAC_PAYLOAD_KEYS,
} from "../src/streamer/internal/signalSchema.js";

describe("streamer signal", () => {
  it("captures the SOAC payload surface", () => {
    expect(STREAMER_SOAC_EVENT).toBe("soac");
    expect(STREAMER_SOAC_TYPES).toEqual(["offer", "answer", "candidate", "restart_ice"]);
    expect(STREAMER_CONTROLLER_OUTBOUND_SOAC_TYPES).toEqual(["offer", "candidate", "restart_ice"]);
    expect(STREAMER_CONTROLLER_INBOUND_SOAC_TYPES).toEqual(["answer", "candidate", "restart_ice"]);
    expect(STREAMER_ICE_NETWORK_TYPES.appAuto).toBe(3);
    expect(STREAMER_SOAC_MESSAGE_KEYS).toEqual(["client_id", "data"]);
    expect(STREAMER_SOAC_PAYLOAD_KEYS).toEqual([
      "type",
      "sdp",
      "ice_id",
      "app_control_id",
      "gzip_sdp",
      "ice_network_type",
      "candidate",
      "sdpMid",
      "sdpMLineIndex",
    ]);
    expect(STREAMER_CONTROLLER_SIGNAL_EVENTS).toEqual([
      "soac",
      "streamer_push",
      "forward_setting",
      "device_capability",
    ]);
  });

  it("captures signal connection headers used by upstream socket.io connect", () => {
    expect(STREAMER_SIGNAL_HEADER_KEYS).toEqual([
      "X-NRD-AUTH",
      "X-NRD-CONTROLLING",
      "streamer_version",
      "streamer_flag",
    ]);
    expect(STREAMER_CLIENT_VERSION).toBe("V4.6.0");
    expect(STREAMER_DEFAULT_SIGNAL_HEADER_VALUES).toEqual({
      "X-NRD-CONTROLLING": "0",
      streamer_version: "V4.6.0",
    });
    expect(buildStreamerSignalHeaders({ token: "room-token", gzipSdp: true }).streamer_flag).toBe(
      '{"sdp_flags":{"gzip_sdp":true}}',
    );
    expect(buildStreamerSignalHeaders({ token: "room-token", streamerVersion: "V9.9.9" })).toMatchObject({
      "X-NRD-CONTROLLING": "0",
      streamer_version: "V9.9.9",
    });
  });

  it("captures controller socket.io event names and control payload keys", () => {
    expect(STREAMER_SIGNAL_SOCKET_EVENTS).toEqual({
      control: "control",
      leave: "leave",
      bmsgPush: "bmsg_push",
      publisherDisconnect: "publisher_disconnect",
    });
    expect(STREAMER_CONTROL_EVENT_NAME).toBe("control");
    expect(STREAMER_CONTROL_EVENT_PAYLOAD_KEYS).toEqual(["app_control_id", "app_data", "streamer_data"]);
    expect(STREAMER_CONTROL_EVENT_PAYLOAD_TYPES).toEqual({
      app_control_id: "string",
      app_data: "binary",
      streamer_data: "string",
    });
    expect(STREAMER_CONTROL_EVENT_WIRE_ARGUMENT_ORDER).toEqual(["app_control_id", "app_data", "streamer_data"]);
    expect(STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS).toBe(10000);
  });

  it("normalizes App control ack into browser WebRTC ICE configuration", () => {
    expect(STREAMER_CONTROL_RESULT_KEYS).toEqual([
      "client_id",
      "ice_id",
      "iceServers",
      "app_data",
      "streamer_data",
      "app_control_id",
      "controller_platform",
      "force_relay",
      "auto_switch_network",
      "relay_ins_type",
      "force_auto_switch_pkt_loss",
      "force_auto_switch_latency",
      "possible_auto_switch_pkt_loss",
      "possible_auto_switch_latency",
      "code",
      "msg",
    ]);
    expect(STREAMER_CONTROL_RESULT_ICE_SERVER_KEYS).toEqual(["urls", "username", "credential"]);

    const control = normalizeStreamerSignalControlAck([
      "success",
      {
        client_id: "controlled-1",
        ice_id: "ice-1",
        app_control_id: "control-1",
        iceServers: [
          {
            urls: "turn:relay.example:3478?transport=udp",
            username: "turn-user",
            credential: "turn-pass",
          },
          {
            urls: "stun:stun.example:3478",
          },
        ],
        app_data: {
          kind: "binary",
          byteLength: 3,
          base64: "AQID",
        },
        streamer_data: '{"control_id":"control-1"}',
        controller_platform: 4,
        publisher_country: "CN",
        publisher_province: "Zhejiang",
        publisher_city: "Hangzhou",
        publisher_isp: "cmcc",
        publisher_relay_isp: "uu",
        subscriber_country: "CN",
        subscriber_province: "Shanghai",
        subscriber_city: "Shanghai",
        subscriber_isp: "telecom",
        subscriber_relay_isp: "uu",
        force_relay: true,
        auto_switch_network: true,
        relay_ins_type: 2,
        force_auto_switch_pkt_loss: 18,
        force_auto_switch_latency: 160,
        possible_auto_switch_pkt_loss: 8,
        possible_auto_switch_latency: 90,
        code: 0,
        msg: "ok",
      },
    ]);

    expect(control).toEqual({
      ackStatus: "success",
      result: {
        clientId: "controlled-1",
        iceId: "ice-1",
        appControlId: "control-1",
        code: 0,
        msg: "ok",
        appDataBase64: "AQID",
        streamerData: '{"control_id":"control-1"}',
        controllerPlatform: 4,
        forceRelay: true,
        autoSwitchNetwork: true,
        relayInsType: 2,
        forceAutoSwitchPacketLoss: 18,
        forceAutoSwitchLatency: 160,
        possibleAutoSwitchPacketLoss: 8,
        possibleAutoSwitchLatency: 90,
        iceServers: [
          {
            urls: "turn:relay.example:3478?transport=udp",
            username: "turn-user",
            credential: "turn-pass",
          },
          {
            urls: "stun:stun.example:3478",
          },
        ],
        publisher: {
          country: "CN",
          province: "Zhejiang",
          city: "Hangzhou",
          isp: "cmcc",
          relayIsp: "uu",
        },
        subscriber: {
          country: "CN",
          province: "Shanghai",
          city: "Shanghai",
          isp: "telecom",
          relayIsp: "uu",
        },
      },
    });
    expect(buildStreamerRtcConfiguration(control.result)).toEqual({
      iceServers: [
        {
          urls: "turn:relay.example:3478?transport=udp",
          username: "turn-user",
          credential: "turn-pass",
        },
        {
          urls: "stun:stun.example:3478",
        },
      ],
      iceTransportPolicy: "relay",
    });
  });

  it("builds app-compatible signal headers with room token and gzip SDP support", () => {
    expect(buildStreamerSignalHeaders({ token: "room-token" })).toEqual({
      "X-NRD-AUTH": "room-token",
      "X-NRD-CONTROLLING": "0",
      streamer_version: "V4.6.0",
      streamer_flag: '{"sdp_flags":{"gzip_sdp":true}}',
    });
  });

  it("builds App-shaped SOAC messages for browser SDP and ICE candidates", () => {
    expect(
      buildStreamerSoacPayload({
        type: "offer",
        clientId: "controlled-1",
        appControlId: "control-1",
        iceId: "ice-1",
        sdp: "v=0",
        iceNetworkType: STREAMER_ICE_NETWORK_TYPES.appAuto,
      } as Parameters<typeof buildStreamerSoacPayload>[0] & { iceId: string }),
    ).toEqual({
      client_id: "controlled-1",
      data: {
        type: "offer",
        sdp: "v=0",
        ice_id: "ice-1",
        app_control_id: "control-1",
        ice_network_type: 3,
      },
    });

    expect(
      buildStreamerSoacPayload({
        type: "candidate",
        clientId: "controlled-1",
        appControlId: "control-1",
        iceId: "ice-1",
        iceNetworkType: STREAMER_ICE_NETWORK_TYPES.appAuto,
        candidate: {
          candidate: "candidate:1 1 udp 1 192.168.1.2 10000 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      } as Parameters<typeof buildStreamerSoacPayload>[0] & { iceId: string }),
    ).toEqual({
      client_id: "controlled-1",
      data: {
        type: "candidate",
        ice_id: "ice-1",
        app_control_id: "control-1",
        candidate: {
          candidate: "candidate:1 1 udp 1 192.168.1.2 10000 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      },
    });
  });
});
