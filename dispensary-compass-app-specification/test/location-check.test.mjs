import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../public/location-check.html", import.meta.url), "utf8");
const script = html.match(/<script id="location-check-script">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
function harness({ secure = true, policy, geo = true, permissions } = {}) {
  const elements = new Map(["test", "reload", "status", "report"].map((id) => [id, {
    textContent: "", disabled: false, addEventListener(event, callback) { this[event] = callback; },
  }]));
  const events = {}, timers = [], calls = [];
  const document = { visibilityState: "visible", getElementById: (id) => elements.get(id) };
  if (policy !== undefined) document.permissionsPolicy = { allowsFeature: () => policy };
  let reloaded = false;
  const window = { isSecureContext: secure, location: { reload: () => { reloaded = true; } },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    addEventListener: (name, fn) => { events[name] = fn; } };
  window.top = window;
  const navigator = { userActivation: { isActive: true }, permissions };
  if (geo) navigator.geolocation = { getCurrentPosition: (...args) => calls.push(args) };
  vm.runInNewContext(script, { window, navigator, document, performance: { now: () => 10 } });
  return { elements, document, navigator, calls, events, timers,
    click: () => elements.get("test").click(), data: () => JSON.parse(elements.get("report").textContent),
    wasReloaded: () => reloaded };
}

test("standalone check only requests once, synchronously on a tap", () => {
  const h = harness();
  assert.equal(h.calls.length, 0);
  assert.equal(h.data().result, "NOT_RUN");
  h.click(); h.click();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][2])), { enableHighAccuracy: false, maximumAge: 0, timeout: 20000 });
  assert.equal(h.data().userActivation, true);
  assert.equal(h.elements.get("test").disabled, true);
});
test("success never reads or serializes coordinates", () => {
  const h = harness(); h.click();
  const position = new Proxy({}, { get() { throw Error("position fields must not be read"); } });
  h.calls[0][0](position);
  assert.equal(h.data().result, "SUCCESS");
  assert.equal(h.data().code, 0);
  assert.equal(h.data().browserPermission, "not_exposed");
});
test("raw denial is preserved without claiming the user pressed Deny", () => {
  const h = harness(); h.click();
  h.calls[0][1]({ code: 1, message: "User denied Geolocation" });
  assert.equal(h.data().result, "DENIED");
  assert.equal(h.data().message, "User denied Geolocation");
  assert.match(h.elements.get("status").textContent, /exact browser\/OS cause is still unconfirmed/);
});
test("policy, insecure context and unavailable API block without a request", () => {
  for (const [options, expected] of [[{ policy: false }, "POLICY_BLOCKED"], [{ secure: false }, "INSECURE"], [{ geo: false }, "UNAVAILABLE"]]) {
    const h = harness(options); h.click();
    assert.equal(h.calls.length, 0); assert.equal(h.data().result, expected);
  }
});
test("timeouts and unavailable errors are not mislabeled as denial", () => {
  for (const [code, result] of [[2, "POSITION_UNAVAILABLE"], [3, "TIMEOUT"]]) {
    const h = harness(); h.click(); h.calls[0][1]({ code, message: "browser error" });
    assert.equal(h.data().result, result);
  }
});
test("unanswered prompt does not manufacture a denial or start retries", () => {
  const h = harness(); h.click(); h.timers[0](); h.click();
  assert.equal(h.data().result, "NO_CALLBACK_YET"); assert.equal(h.calls.length, 1);
  h.calls[0][0](); assert.equal(h.data().result, "SUCCESS");
});
test("departed page ignores late position and permission callbacks", async () => {
  let resolve;
  const h = harness({ permissions: { query: () => new Promise((r) => { resolve = r; }) } });
  h.click(); h.calls[0][1]({ code: 1, message: "denied" });
  h.events.pagehide(); resolve({ state: "granted" }); await Promise.resolve();
  h.calls[0][0](); assert.equal(h.data().result, "DENIED");
  assert.equal(h.data().browserPermission, "not_queried");
});
test("permission API exceptions do not suppress the actual request", () => {
  const h = harness({ permissions: { query() { throw Error("not supported"); } } });
  h.click(); assert.equal(h.calls.length, 1); h.calls[0][0]();
  assert.equal(h.data().result, "SUCCESS"); assert.equal(h.data().browserPermission, "unavailable");
});
test("page contains no external scripts, location storage, network calls or watcher", () => {
  assert.doesNotMatch(html, /<script[^>]+src=|<iframe|watchPosition|localStorage|sessionStorage|sendBeacon|\bfetch\s*\(|XMLHttpRequest/);
  const h = harness(); h.elements.get("reload").click(); assert.equal(h.wasReloaded(), true);
});
