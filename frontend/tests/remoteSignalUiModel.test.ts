import { describe, expect, it } from "vitest";

import { formatControlRoutingDecision, formatPeerNetworkInfo } from "../src/remote/remoteSignalUiModel.js";

describe("formatControlRoutingDecision", () => {
  it("returns a placeholder without a control result", () => {
    expect(formatControlRoutingDecision(undefined)).toBe("-");
    expect(formatControlRoutingDecision(null)).toBe("-");
  });

  it("renders the routing decision fields from the control ack", () => {
    expect(
      formatControlRoutingDecision({ forceRelay: true, autoSwitchNetwork: false, relayInsType: 3, iceServers: [] }),
    ).toBe("force_relay=是 · auto_switch=否 · relay_ins_type=3");
    expect(formatControlRoutingDecision({ iceServers: [] })).toBe("force_relay=- · auto_switch=- · relay_ins_type=-");
  });
});

describe("formatPeerNetworkInfo", () => {
  it("returns a placeholder without peer info", () => {
    expect(formatPeerNetworkInfo(undefined)).toBe("-");
    expect(formatPeerNetworkInfo({})).toBe("-");
  });

  it("joins region and ISP details", () => {
    expect(
      formatPeerNetworkInfo({ country: "CN", province: "广东", city: "深圳", isp: "电信", relayIsp: "联通" }),
    ).toBe("CN 广东 深圳 · 电信(中转:联通)");
    expect(formatPeerNetworkInfo({ country: "CN", isp: "电信" })).toBe("CN · 电信");
    expect(formatPeerNetworkInfo({ relayIsp: "联通" })).toBe("联通");
  });
});
