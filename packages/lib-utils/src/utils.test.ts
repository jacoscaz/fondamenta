import { test } from "node:test";
import assert from "node:assert";
import { ellipsisAround, ellipsis } from "./utils.js";

/**
 * ellipsisAround — match-aware previews (2026-09-24, hamster incident):
 * a 100-char head cut hid an exact-phrase match at char 767 of the origin
 * record; every preview read "truthfully" showed nothing. The preview
 * must window around where the query matched.
 */

test("ellipsis: head cut (baseline, unchanged behaviour)", () => {
  const long = "a".repeat(200);
  assert.strictEqual(ellipsis(long, 100).length, 103);
  assert.strictEqual(ellipsis(long, 100), "a".repeat(100) + "...");
});

test("ellipsisAround: windows around the match, not the head", () => {
  const content = "The trial verdict landed this morning. ".repeat(20) +
    "a hyperactive hamster never exercises judgment. " +
    "The end of the record.".repeat(10);
  const out = ellipsisAround(content, "hyperactive hamster", 100);
  assert.ok(out.includes("**hyperactive hamster**"), "match is marked");
  assert.ok(out.startsWith("...") && out.endsWith("..."), "windowed on both sides");
  assert.ok(out.length < 500, `windowed, not the whole record (len=${out.length})`);
});

test("ellipsisAround: match at the very start — no leading ellipsis", () => {
  const content = "hamster first words here. " + "x".repeat(400);
  const out = ellipsisAround(content, "hamster", 100);
  assert.ok(out.startsWith("**hamster**"), `starts at the match: ${out.slice(0, 30)}`);
  assert.ok(out.endsWith("..."));
});

test("ellipsisAround: match at the very end — no trailing ellipsis", () => {
  const content = "x".repeat(400) + " ends with hamster";
  const out = ellipsisAround(content, "hamster", 100);
  assert.ok(out.startsWith("..."));
  assert.ok(out.endsWith("**hamster**"), `ends at the match: ${out.slice(-30)}`);
});

test("ellipsisAround: falls back to head cut when term absent", () => {
  const content = "nothing relevant here at all. " + "y".repeat(300);
  const out = ellipsisAround(content, "hamster", 100);
  assert.strictEqual(out, ellipsis(content, 100));
});

test("ellipsisAround: empty/blank term falls back to head cut", () => {
  const content = "some content. " + "z".repeat(300);
  assert.strictEqual(ellipsisAround(content, "", 100), ellipsis(content, 100));
  assert.strictEqual(ellipsisAround(content, "   ", 100), ellipsis(content, 100));
});

test("ellipsisAround: case-insensitive match", () => {
  const content = "prefix text. ".padEnd(200, ".") + " A HYPERACTIVE HAMSTER runs. " + "suffix".repeat(50);
  const out = ellipsisAround(content, "hyperactive hamster", 100);
  assert.ok(out.includes("**HYPERACTIVE HAMSTER**"), "matches case-insensitively, marks original casing");
});

test("ellipsisAround: short content containing term is fully kept", () => {
  const content = "the hamster story, short and whole";
  const out = ellipsisAround(content, "hamster", 100);
  assert.strictEqual(out, "the **hamster** story, short and whole");
});
