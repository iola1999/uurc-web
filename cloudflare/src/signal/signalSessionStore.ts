import {
  SIGNAL_GATEWAY_EVENT_RETENTION_MS,
  SIGNAL_GATEWAY_MAX_EVENTS,
  SIGNAL_MAX_EVENT_BYTES,
} from "@uurc/shared/signalGateway/status";
import type {
  RemoteSignalGatewayEvent,
  RemoteSignalGatewayEventDirection,
  RemoteSignalGatewayStatus,
} from "@uurc/shared/signalGateway/model";

type SignalSqlStorage = DurableObjectStorage["sql"];

export class SignalSessionStore {
  constructor(private readonly sql: SignalSqlStorage) {}

  initialize(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS signal_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS signal_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL,
        event TEXT NOT NULL,
        received_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
  }

  readStatus(): RemoteSignalGatewayStatus | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM signal_state WHERE key = ?", "status").toArray()[0];
    if (!row?.value) return null;
    try {
      return JSON.parse(row.value) as RemoteSignalGatewayStatus;
    } catch {
      return null;
    }
  }

  writeStatus(status: RemoteSignalGatewayStatus): void {
    this.sql.exec("INSERT OR REPLACE INTO signal_state (key, value) VALUES (?, ?)", "status", JSON.stringify(status));
  }

  clearEvents(): void {
    this.sql.exec("DELETE FROM signal_events");
  }

  readEvents(afterEventId = 0): RemoteSignalGatewayEvent[] {
    this.pruneEvents();
    return this.sql
      .exec<{
        id: number;
        direction: RemoteSignalGatewayEventDirection;
        event: string;
        received_at: string;
        payload_json: string;
      }>(
        "SELECT id, direction, event, received_at, payload_json FROM signal_events WHERE id > ? ORDER BY id ASC LIMIT ?",
        afterEventId,
        SIGNAL_GATEWAY_MAX_EVENTS,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        direction: row.direction,
        event: row.event,
        receivedAt: row.received_at,
        payload: parseJson(row.payload_json),
      }));
  }

  recordEvent(input: Omit<RemoteSignalGatewayEvent, "id" | "receivedAt">): void {
    this.pruneEvents();
    this.sql.exec(
      "INSERT INTO signal_events (direction, event, received_at, payload_json) VALUES (?, ?, ?, ?)",
      input.direction,
      input.event,
      new Date().toISOString(),
      JSON.stringify(input.payload ?? null),
    );
    this.sql.exec(
      "DELETE FROM signal_events WHERE id NOT IN (SELECT id FROM signal_events ORDER BY id DESC LIMIT ?)",
      SIGNAL_GATEWAY_MAX_EVENTS,
    );
    this.sql.exec(
      "DELETE FROM signal_events WHERE id IN (SELECT id FROM (SELECT id, SUM(length(CAST(payload_json AS BLOB)) + length(CAST(event AS BLOB)) + 128) OVER (ORDER BY id DESC) AS total FROM signal_events) WHERE total > ?)",
      SIGNAL_MAX_EVENT_BYTES,
    );
  }

  pruneEvents(): void {
    const cutoff = new Date(Date.now() - SIGNAL_GATEWAY_EVENT_RETENTION_MS).toISOString();
    this.sql.exec("DELETE FROM signal_events WHERE received_at < ?", cutoff);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
