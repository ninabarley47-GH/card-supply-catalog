import test from "node:test";
import assert from "node:assert/strict";
import { IPAD_BACKUP_COMPRESSION, shouldBlockOversizedIpadImport } from "./backup.js";

test("compact iPad backup profile stays within the intended image budget", () => {
  assert.deepEqual(IPAD_BACKUP_COMPRESSION, {
    format: "image/jpeg",
    maxDimension: 400,
    quality: 0.55
  });
});

test("iPad blocks legacy oversized imports before reading the file", () => {
  assert.equal(shouldBlockOversizedIpadImport({
    fileSize: 303 * 1024 * 1024,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    platform: "iPad",
    maxTouchPoints: 5
  }), true);
  assert.equal(shouldBlockOversizedIpadImport({
    fileSize: 50 * 1024 * 1024,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    platform: "iPad",
    maxTouchPoints: 5
  }), false);
});

test("desktop imports are not blocked by the iPad safety limit", () => {
  assert.equal(shouldBlockOversizedIpadImport({
    fileSize: 303 * 1024 * 1024,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    platform: "Win32",
    maxTouchPoints: 0
  }), false);
});
