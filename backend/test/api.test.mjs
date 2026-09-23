import test from "node:test";
import assert from "node:assert/strict";
import health from "../api/health.js";
import dispensaries from "../api/dispensaries.js";

function mockResponse() {
  const state = { status: 200, headers: {}, body: undefined, ended: false };
  return {
    state,
    setHeader(name, value) { state.headers[name.toLowerCase()] = value; },
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; state.ended = true; return this; },
    end() { state.ended = true; return this; }
  };
}

test("health endpoint returns an explicit service identity", () => {
  const res = mockResponse();
  health({}, res);
  assert.equal(res.state.status, 200);
  assert.equal(res.state.body.service, "compass-api");
  assert.equal(res.state.body.status, "ok");
});

test("POI proxy rejects unapproved origins", async () => {
  const res = mockResponse();
  await dispensaries({
    method: "GET",
    headers: { origin: "https://example.invalid" },
    query: { lat: "41", lon: "-72", radiusMiles: "10" }
  }, res);
  assert.equal(res.state.status, 403);
  assert.equal(res.state.body.error, "origin_not_allowed");
});

test("POI proxy validates coordinates before making provider calls", async () => {
  const res = mockResponse();
  await dispensaries({
    method: "GET",
    headers: { origin: "https://ninja-ops-guy.github.io" },
    query: { lat: "999", lon: "-72", radiusMiles: "10" }
  }, res);
  assert.equal(res.state.status, 400);
  assert.equal(res.state.body.error, "invalid_query");
});
