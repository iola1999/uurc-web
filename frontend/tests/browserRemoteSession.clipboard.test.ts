import { describe, expect, it, vi } from "vitest";

import { encodeStreamerTextMessage } from "@uurc/shared/streamer/controlChannelEncode";
import { STREAMER_CLIPBOARD_FORMAT_NAMES, STREAMER_CLIPBOARD_RESULTS } from "@uurc/shared/streamer/clipboardProtocol";
import { decodeStreamerClipboardMessage } from "@uurc/shared/streamer/clipboardV3";
import {
  decodeStreamerClipboardV4Message,
  encodeStreamerClipboardFormatDataAskRequest,
} from "@uurc/shared/streamer/clipboardV4";
import { STREAMER_DATA_CHANNEL_LABELS } from "@uurc/shared/streamer/transport";
import { BrowserRemoteSession } from "../src/remote/browserRemoteSession.js";
import {
  FakePeerConnection,
  FakeRemoteApi,
  blobFromBytes,
  clipboardDataBlockRequest,
  encodeUtf8,
  flushMicrotasks,
  startClipboardSession,
} from "./browserRemoteSessionTestHarness.js";

function decodeStreamerClipboardTextChangeRequest(data: ArrayBuffer | ArrayBufferView) {
  const message = decodeStreamerClipboardMessage(data);
  return message?.type === "text-change-request" ? message : undefined;
}

describe("BrowserRemoteSession", () => {
  it("publishes remote media streams and sends text data on the App text channel", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    let remoteStream: MediaStream | null = null;
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
      now: () => 1234,
      onRemoteStream: (stream) => {
        remoteStream = stream;
      },
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    const stream = { id: "stream-1" } as MediaStream;
    peer.ontrack?.({ streams: [stream], track: {} } as RTCTrackEvent);
    session.sendTextData(" hello ");

    expect(remoteStream).toBe(stream);
    expect(session.getState().remoteTrackCount).toBe(1);
    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.text)?.sent).toEqual([
      encodeStreamerTextMessage({
        sequence: 1,
        timestampMs: 1,
        inputMessage: " hello ",
      }),
    ]);
  });

  it("sends Clipboard v3 text unchanged and resolves after the text channel accepts it", async () => {
    const nowMs = 1_752_938_123_456;
    const { session, fileChannel, textChannel } = await startClipboardSession({ now: () => nowMs });
    const clipboardText = "  first line\n\u7b2c\u4e8c\u884c \ud83d\udc4b\n";

    await expect(session.sendClipboardText(clipboardText)).resolves.toBeUndefined();

    expect(textChannel.sent).toHaveLength(1);
    expect(fileChannel.sent).toHaveLength(0);
    const request = decodeStreamerClipboardTextChangeRequest(textChannel.sent[0] as Uint8Array);
    expect(request).toEqual({
      type: "text-change-request",
      sequence: 1n,
      timestampMs: BigInt(Math.floor(nowMs / 1000)),
      requestId: 1n,
      formatId: 1,
      text: clipboardText,
    });
  });

  it("preserves empty, whitespace-only, and Unicode clipboard values", async () => {
    const { session, textChannel } = await startClipboardSession();
    const values = ["", " \n\t ", "\u526a\u8d34\u677f \ud83d\udc4b"];

    for (const [index, value] of values.entries()) {
      await session.sendClipboardText(value);
      const request = decodeStreamerClipboardTextChangeRequest(textChannel.sent[index] as Uint8Array);
      expect(request?.text).toBe(value);
    }
  });

  it("re-sends an unchanged local clipboard value when explicitly requested", async () => {
    const { session, textChannel } = await startClipboardSession();
    await session.sendClipboardText("same value");
    await session.sendClipboardText("same value");
    expect(textChannel.sent).toHaveLength(2);
  });

  it("rejects a local clipboard send when the text channel is closed", async () => {
    const { session, textChannel } = await startClipboardSession();
    textChannel.close();
    await expect(session.sendClipboardText("cannot send")).rejects.toThrow(/not open/);
  });

  it("requests the Mac UTF-8 clipboard format on TEXT and receives its data on FILE", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const nowMs = 1_752_938_123_456;
      const { session, fileChannel, textChannel } = await startClipboardSession({
        now: () => nowMs,
        onRemoteClipboard: (text) => received.push(text),
      });
      session.requestRemoteClipboardText();

      expect(textChannel.sent).toEqual([
        encodeStreamerClipboardFormatDataAskRequest({
          sequence: 1,
          timestampMs: Math.floor(nowMs / 1000),
          requestId: 1,
          blockKey: "uurc-web-1-1",
          formatId: 0,
          formatName: STREAMER_CLIPBOARD_FORMAT_NAMES.macUtf8Text,
        }),
      ]);
      expect(fileChannel.sent).toHaveLength(0);

      const remoteText = " remote \n\u526a\u8d34\u677f \ud83d\udc4b\0";
      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 10,
          requestId: 20,
          blockKey: "uurc-web-1-1",
          blockId: 1,
          data: encodeUtf8(remoteText),
        }).buffer,
      );
      await vi.advanceTimersByTimeAsync(250);

      expect(received).toEqual([" remote \n\u526a\u8d34\u677f \ud83d\udc4b"]);
      expect(fileChannel.sent).toHaveLength(1);
      expect(decodeStreamerClipboardV4Message(fileChannel.sent[0] as Uint8Array)).toMatchObject({
        type: "data-block-confirm",
        requestId: 20n,
        blockKey: "uurc-web-1-1",
        blockId: 1,
        result: STREAMER_CLIPBOARD_RESULTS.succeeded,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("assembles multiple Clipboard v4 blocks in block-id order", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const { session, fileChannel } = await startClipboardSession({
        onRemoteClipboard: (text) => received.push(text),
      });
      session.requestRemoteClipboardText();
      const bytes = encodeUtf8("first line\n\u7b2c\u4e8c\u884c\0");
      const splitAt = 12;

      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 11,
          requestId: 31,
          blockKey: "uurc-web-1-1",
          blockId: 2,
          data: bytes.subarray(splitAt),
        }).buffer,
      );
      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 10,
          requestId: 30,
          blockKey: "uurc-web-1-1",
          blockId: 1,
          data: bytes.subarray(0, splitAt),
        }).buffer,
      );
      await vi.advanceTimersByTimeAsync(250);

      expect(received).toEqual(["first line\n\u7b2c\u4e8c\u884c"]);
      expect(fileChannel.sent.map((payload) => decodeStreamerClipboardV4Message(payload as Uint8Array))).toEqual([
        expect.objectContaining({ type: "data-block-confirm", blockId: 2 }),
        expect.objectContaining({ type: "data-block-confirm", blockId: 1 }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a later block after acknowledging a full 128 KiB block", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const { session, fileChannel } = await startClipboardSession({
        onRemoteClipboard: (text) => received.push(text),
      });
      session.requestRemoteClipboardText();
      const firstBlock = new Uint8Array(0x20000).fill(0x61);

      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 10,
          requestId: 30,
          blockKey: "uurc-web-1-1",
          blockId: 1,
          data: firstBlock,
        }).buffer,
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(received).toEqual([]);

      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 11,
          requestId: 31,
          blockKey: "uurc-web-1-1",
          blockId: 2,
          data: encodeUtf8("tail"),
        }).buffer,
      );
      expect(received).toEqual([`${"a".repeat(0x20000)}tail`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes a single full 128 KiB Clipboard v4 block after the fallback window", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const { session, fileChannel } = await startClipboardSession({
        onRemoteClipboard: (text) => received.push(text),
      });
      session.requestRemoteClipboardText();
      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 10,
          requestId: 30,
          blockKey: "uurc-web-1-1",
          blockId: 1,
          data: new Uint8Array(0x20000).fill(0x61),
        }).buffer,
      );

      await vi.advanceTimersByTimeAsync(1999);
      expect(received).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(received).toEqual(["a".repeat(0x20000)]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews the read timeout while multiple full Clipboard v4 blocks make progress", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const { session, fileChannel } = await startClipboardSession({
        onRemoteClipboard: (text) => received.push(text),
      });
      session.requestRemoteClipboardText();
      for (let blockId = 1; blockId <= 3; blockId += 1) {
        fileChannel.emitMessage(
          clipboardDataBlockRequest({
            sequence: 10 + blockId,
            requestId: 30 + blockId,
            blockKey: "uurc-web-1-1",
            blockId,
            data: new Uint8Array(0x20000).fill(0x60 + blockId),
          }).buffer,
        );
        if (blockId < 3) await vi.advanceTimersByTimeAsync(1800);
      }

      await vi.advanceTimersByTimeAsync(1999);
      expect(received).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(received).toEqual([`${"a".repeat(0x20000)}${"b".repeat(0x20000)}${"c".repeat(0x20000)}`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("synchronizes an empty clipboard from a zero-byte Clipboard v4 block", async () => {
    const received: string[] = [];
    const { session, fileChannel } = await startClipboardSession({
      onRemoteClipboard: (text) => received.push(text),
    });
    session.requestRemoteClipboardText();
    fileChannel.emitMessage(
      clipboardDataBlockRequest({
        sequence: 10,
        requestId: 30,
        blockKey: "uurc-web-1-1",
        blockId: 1,
        data: new Uint8Array(),
      }).buffer,
    );
    expect(received).toEqual([""]);
  });

  it("suppresses a polled echo of text just sent to the remote clipboard", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const { session, fileChannel } = await startClipboardSession({
        onRemoteClipboard: (text) => received.push(text),
      });
      await session.sendClipboardText("local echo");
      session.requestRemoteClipboardText();
      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 10,
          requestId: 20,
          blockKey: "uurc-web-1-2",
          blockId: 1,
          data: encodeUtf8("local echo\0"),
        }).buffer,
      );
      await vi.advanceTimersByTimeAsync(250);
      expect(received).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops malformed Clipboard v4 text and permits the next poll", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const { session, fileChannel, textChannel } = await startClipboardSession({
        onRemoteClipboard: (text) => received.push(text),
      });
      session.requestRemoteClipboardText();
      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 10,
          requestId: 20,
          blockKey: "uurc-web-1-1",
          blockId: 1,
          data: new Uint8Array([0xff]),
        }).buffer,
      );
      await vi.advanceTimersByTimeAsync(250);

      expect(received).toEqual([]);
      session.requestRemoteClipboardText();
      expect(textChannel.sent).toHaveLength(2);
      expect(session.getState().debugEvents).toEqual(
        expect.arrayContaining([expect.objectContaining({ summary: "远端剪贴板文本解码失败" })]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out an unanswered Clipboard v4 poll and permits a retry", async () => {
    vi.useFakeTimers();
    try {
      const { session, textChannel } = await startClipboardSession();
      session.requestRemoteClipboardText();
      session.requestRemoteClipboardText();
      expect(textChannel.sent).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(5000);
      session.requestRemoteClipboardText();
      expect(textChannel.sent).toHaveLength(2);
      expect(session.getState().debugEvents).toEqual(
        expect.arrayContaining([expect.objectContaining({ summary: "读取远端剪贴板超时" })]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels Clipboard v4 assembly when either clipboard channel closes", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const { session, fileChannel } = await startClipboardSession({
        onRemoteClipboard: (text) => received.push(text),
      });
      session.requestRemoteClipboardText();
      fileChannel.close();
      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 10,
          requestId: 20,
          blockKey: "uurc-web-1-1",
          blockId: 1,
          data: encodeUtf8("late\0"),
        }).buffer,
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(received).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("receives Clipboard v4 blocks from a remote-created FILE channel as Blob data", async () => {
    vi.useFakeTimers();
    try {
      const received: string[] = [];
      const { peer, session, fileChannel } = await startClipboardSession({
        onRemoteClipboard: (text) => received.push(text),
      });
      const incomingFileChannel = peer.emitIncomingDataChannel(STREAMER_DATA_CHANNEL_LABELS.file);
      session.requestRemoteClipboardText();
      incomingFileChannel.emitMessage(
        blobFromBytes(
          clipboardDataBlockRequest({
            sequence: 10,
            requestId: 20,
            blockKey: "uurc-web-1-1",
            blockId: 1,
            data: encodeUtf8("remote clipboard\0"),
          }),
        ),
      );
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(250);
      expect(received).toEqual(["remote clipboard"]);
      expect(decodeStreamerClipboardV4Message(fileChannel.sent[0] as Uint8Array)).toMatchObject({
        type: "data-block-confirm",
        requestId: 20n,
        blockId: 1,
      });

      session.close();
      expect(incomingFileChannel.closed).toBe(true);
      expect(peer.ondatachannel).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Clipboard v4 text and encoded payload prefixes out of debug events", async () => {
    vi.useFakeTimers();
    try {
      const secret = "clipboard-secret-\u526a\u8d34\u677f";
      const { session, fileChannel } = await startClipboardSession();
      session.requestRemoteClipboardText();
      fileChannel.emitMessage(
        clipboardDataBlockRequest({
          sequence: 10,
          requestId: 20,
          blockKey: "uurc-web-1-1",
          blockId: 1,
          data: encodeUtf8(`${secret}\0`),
        }).buffer,
      );
      await vi.advanceTimersByTimeAsync(250);

      const events = session.getState().debugEvents;
      expect(JSON.stringify(events)).not.toContain(secret);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            summary: "远端剪贴板读取完成",
            details: expect.objectContaining({
              blockCount: 1,
              byteLength: expect.any(Number),
              textLength: secret.length,
            }),
          }),
        ]),
      );
      expect(
        events.some(
          (event) => event.kind === "data_recv" && event.details && Object.hasOwn(event.details, "hexPrefix"),
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
