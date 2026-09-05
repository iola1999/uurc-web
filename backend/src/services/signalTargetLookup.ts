import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { isPublicSignalAddress } from "@uurc/shared/signalGateway/authorization";

// 将通过校验的解析结果直接交给连接，重连时重新检查。
export const lookupPublicSignalAddress: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    if (!addresses.length || addresses.some(({ address }) => !isPublicSignalAddress(address))) {
      return callback(new Error("Signal DNS resolved to a non-public address"), []);
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};
