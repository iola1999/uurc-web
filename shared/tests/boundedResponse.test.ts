import { expect, it, vi } from "vitest";
import { readBoundedText } from "../src/uuProxy.js";

it("cancels a response body that stalls after headers", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const controller = new AbortController();
  const pending = readBoundedText({ body }, controller.signal);
  controller.abort(new Error("deadline"));
  await expect(pending).rejects.toThrow("deadline");
  expect(cancel).toHaveBeenCalledOnce();
});

it("limits bytes across chunks and decodes split UTF-8 characters", async () => {
  const bytes = new TextEncoder().encode("中文");
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 2));
        controller.enqueue(bytes.subarray(2));
        controller.close();
      },
    });
  await expect(readBoundedText({ body: stream() }, undefined, 6)).resolves.toBe("中文");
  await expect(readBoundedText({ body: stream() }, undefined, 5)).rejects.toThrow("exceeds");
});
