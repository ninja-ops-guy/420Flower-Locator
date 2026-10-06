import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://example.test";
const scope = `${origin}/420Flower-Locator/`;
function harness({ offline = false, cached = new Response("cached app") } = {}) {
  const events = {}, puts = [];
  const cache = { match: async () => cached, put: async (key, response) => puts.push([key, await response.text()]) };
  const self = { registration: { scope }, addEventListener: (name, fn) => { events[name] = fn; } };
  vm.runInNewContext(source, { self, URL, Response, caches: { open: async () => cache },
    fetch: async () => { if (offline) throw Error("offline"); return new Response("live app"); } });
  function request(path, mode = "navigate") {
    let response;
    const pending = [];
    events.fetch({ request: { url: new URL(path, scope).href, method: "GET", mode },
      respondWith: (promise) => { response = promise; }, waitUntil: (promise) => pending.push(promise) });
    return { get response() { return response; }, pending };
  }
  return { puts, request };
}

test("independent check and legal pages bypass app-shell navigation cache", () => {
  const h = harness();
  for (const path of ["location-check.html", "location-check.html?test=1", "privacy.html", "terms.html", "business.html"]) {
    assert.equal(h.request(path).response, undefined, path);
  }
  assert.equal(h.puts.length, 0);
});
test("same-origin requests outside Compass do not enter its cache", () => {
  const h = harness();
  assert.equal(h.request("/other-app/", "cors").response, undefined);
  assert.equal(h.request("https://elsewhere.test/map.png", "cors").response, undefined);
});
test("only root and index navigation refresh the canonical app shell", async () => {
  for (const path of ["./", "./?refresh=1", "index.html"]) {
    const h = harness(); const r = h.request(path);
    assert.equal(await (await r.response).text(), "live app");
    await Promise.all(r.pending);
    assert.deepEqual(h.puts, [["./", "live app"]]);
  }
});
test("offline root uses its own shell; auxiliary pages never receive that shell", async () => {
  const h = harness({ offline: true });
  assert.equal(await (await h.request("./").response).text(), "cached app");
  assert.equal(h.request("location-check.html").response, undefined);
});
test("missing offline shell produces a controlled response", async () => {
  const h = harness({ offline: true, cached: null });
  assert.equal((await h.request("./").response).status, 503);
});
