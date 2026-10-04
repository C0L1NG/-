import test from "node:test";
import assert from "node:assert/strict";
import { matchesRequestOrigin } from "../../web/lib/request-origin.ts";

test("same-origin validation uses request Host rather than Next internal hostname", () => {
  assert.equal(
    matchesRequestOrigin("http://127.0.0.1:3005", "127.0.0.1:3005", "http:"),
    true,
  );
  assert.equal(
    matchesRequestOrigin("http://localhost:3005", "localhost:3005", "http:"),
    true,
  );
});
test("public HTTPS origin stays strict behind a proxy with an internal HTTP origin", () => {
  assert.equal(
    matchesRequestOrigin(
      "https://console.example.com",
      "localhost:3001",
      "http:",
      "https://console.example.com",
    ),
    true,
  );
  for (const origin of [
    null,
    "https://evil.example.com",
    "https://console.example.com.evil",
    "https://console.example.com/path",
    "http://console.example.com",
  ])
    assert.equal(
      matchesRequestOrigin(
        origin,
        "localhost:3001",
        "http:",
        "https://console.example.com",
      ),
      false,
    );
});
