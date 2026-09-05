import { createHash } from "node:crypto";
import { REMOTE_SESSION_IDLE_MS, type SignalRoomAuthorization } from "@uurc/shared/signalGateway/authorization";

import { RemoteControlService } from "./remoteControlService.js";
import type { SignalGatewayConnector } from "./signalGateway.js";

const DEFAULT_MAX_REMOTE_SESSIONS = 64;
const DEFAULT_REMOTE_SESSION_IDLE_TTL_MS = REMOTE_SESSION_IDLE_MS;

interface RemoteControlSessionEntry {
  service: RemoteControlService;
  lastAccessedAt: number;
  timer: ReturnType<typeof setTimeout>;
  authorization?: SignalRoomAuthorization;
}

interface RemoteControlSessionRegistryOptions {
  maxSessions?: number;
  idleTtlMs?: number;
  now?: () => number;
}

export class RemoteControlSessionRegistry {
  private readonly sessions = new Map<string, RemoteControlSessionEntry>();
  private readonly maxSessions: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly signalGatewayConnector?: SignalGatewayConnector,
    options: RemoteControlSessionRegistryOptions = {},
  ) {
    this.maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_REMOTE_SESSIONS);
    this.idleTtlMs = Math.max(1, options.idleTtlMs ?? DEFAULT_REMOTE_SESSION_IDLE_TTL_MS);
    this.now = options.now ?? Date.now;
  }

  getOrCreate(sessionId: string): RemoteControlService {
    const now = this.now();
    this.pruneExpired(now);
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccessedAt = now;
      existing.timer.refresh();
      return existing.service;
    }

    if (this.sessions.size >= this.maxSessions) throw new Error("Remote session capacity reached; retry later");

    const service = new RemoteControlService(undefined, this.signalGatewayConnector, hashSessionId(sessionId));
    const timer = setTimeout(() => {
      const entry = this.sessions.get(sessionId);
      if (entry) this.evict(sessionId, entry);
    }, this.idleTtlMs);
    timer.unref();
    this.sessions.set(sessionId, { service, lastAccessedAt: now, timer });
    return service;
  }

  get(sessionId: string): RemoteControlService | undefined {
    this.pruneExpired(this.now());
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    entry.lastAccessedAt = this.now();
    entry.timer.refresh();
    return entry.service;
  }

  authorize(sessionId: string, authorization: SignalRoomAuthorization): void {
    this.getOrCreate(sessionId);
    this.sessions.get(sessionId)!.authorization = authorization;
  }

  authorization(sessionId: string): SignalRoomAuthorization | undefined {
    return this.sessions.get(sessionId)?.authorization;
  }

  release(sessionId: string): void {
    clearTimeout(this.sessions.get(sessionId)?.timer);
    this.sessions.delete(sessionId);
  }

  get size(): number {
    return this.sessions.size;
  }

  private pruneExpired(now: number): void {
    for (const [sessionId, entry] of this.sessions) {
      if (now - entry.lastAccessedAt >= this.idleTtlMs) this.evict(sessionId, entry);
    }
  }

  private evict(sessionId: string, entry: RemoteControlSessionEntry): void {
    this.release(sessionId);
    void entry.service.stopSignalGateway().catch(() => {
      // Session eviction must continue even when a connector fails during cleanup.
    });
  }
}

function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
}
