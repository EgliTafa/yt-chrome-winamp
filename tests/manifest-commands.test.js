import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("declares all media commands within Chrome's suggested-shortcut limit", async () => {
  const manifestUrl = new URL("../manifest.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const commands = manifest.commands || {};

  assert.deepEqual(Object.keys(commands), [
    "media-play-pause",
    "media-next",
    "media-previous",
    "volume-up",
    "volume-down",
  ]);
  assert.ok(Object.values(commands).every((command) => command.global === true));
  assert.ok(Object.values(commands).every((command) => command.description));
  assert.ok(
    Object.values(commands).filter((command) => command.suggested_key).length <= 4,
    "Chrome accepts at most four suggested extension shortcuts"
  );
});
