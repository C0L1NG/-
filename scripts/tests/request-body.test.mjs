import test from "node:test";
import assert from "node:assert/strict";
import { readLimitedBody } from "../../web/lib/request-body.ts";

test("BFF bounds UTF-8 bytes and cancels chunked requests on overflow", async () => {
  let cancelled = false;
  const bytes = new TextEncoder().encode("佣".repeat(3000));
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 6000));
      controller.enqueue(bytes.subarray(6000));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readLimitedBody({ headers: new Headers(), body }), {
    status: 413,
  });
  assert.equal(cancelled, true);
});

test("BFF handles characters spanning chunks and rejects a large declared body before reading", async () => {
  const bytes = new TextEncoder().encode('{"label":"佣金"}');
  const body = new ReadableStream({
    start(c) {
      c.enqueue(bytes.subarray(0, 11));
      c.enqueue(bytes.subarray(11));
      c.close();
    },
  });
  assert.equal(
    await readLimitedBody({ headers: new Headers(), body }),
    '{"label":"佣金"}',
  );
  await assert.rejects(
    readLimitedBody({
      headers: new Headers({ "content-length": "9000" }),
      body: null,
    }),
    { status: 413 },
  );
});
