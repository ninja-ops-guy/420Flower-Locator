import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const expected = process.env.GITHUB_SHA;
assert.match(expected ?? "", /^[a-f0-9]{40}$/, "GITHUB_SHA must identify the deployed commit");
const base = new URL("https://ninja-ops-guy.github.io/420Flower-Locator/");

async function get(name) {
  const url = new URL(name, base);
  assert.equal(url.origin, base.origin);
  assert.ok(url.pathname.startsWith(base.pathname), "Verification must stay inside Compass");
  url.searchParams.set("compass_verify", expected);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${name}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

let failure;
for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    const proof = JSON.parse((await get("build.json")).toString("utf8"));
    assert.equal(proof.revision, expected, "Live build is not the just-deployed revision");
    assert.ok(proof.files && typeof proof.files === "object");
    for (const name of ["index.html", "sw.js", "manifest.webmanifest", "icon.svg"]) {
      assert.ok(Object.hasOwn(proof.files, name), `Missing proof for ${name}`);
    }
    const entries = Object.entries(proof.files);
    assert.ok(entries.length >= 5 && entries.length <= 100, "Unexpected asset manifest size");
    const loaded = new Map(await Promise.all(entries.map(async ([name, hash]) => {
      assert.match(name, /^(?:index\.html|sw\.js|manifest\.webmanifest|icon\.svg|assets\/[A-Za-z0-9._/-]+)$/);
      assert.ok(!name.split("/").includes(".."), "Parent paths are forbidden");
      assert.match(hash, /^[a-f0-9]{64}$/);
      const bytes = await get(name);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, `Live asset mismatch: ${name}`);
      return [name, bytes.toString("utf8")];
    })));
    assert.match(loaded.get("index.html"), /Compass — Nearest Dispensary Finder/);
    const scripts = [...loaded].filter(([name]) => name.startsWith("assets/") && name.endsWith(".js")).map(([, text]) => text).join("\n");
    assert.ok(scripts.includes("Safari denied this geolocation request"), "Recovery update is missing");
    assert.ok((scripts.match(/geo-code=/g) ?? []).length >= 2, "Both diagnostic surfaces must be deployed");
    assert.ok(!scripts.includes("Safari reports location permission denied for this site"), "Old misleading error is still deployed");
    console.log(`COMPASS_LIVE_VERIFIED revision=${expected} assets=${entries.length} sha256=PASS location_recovery_markers=PASS`);
    process.exit(0);
  } catch (error) {
    failure = error;
    console.log(`Attempt ${attempt}/12: ${error.message}`);
    if (attempt < 12) await delay(10000);
  }
}
throw failure;
