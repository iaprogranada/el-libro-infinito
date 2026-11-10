import assert from "node:assert/strict";
import { test } from "node:test";
import { euros, quote } from "../src/lib/pricing.ts";

test("párrafo solo: 1 €", () => {
  const q = quote({ signed: false, gold: false, invite: null });
  assert.equal(q.total, 100);
  assert.equal(q.lines.length, 1);
});

test("con firma y dorado: 3 €", () => {
  assert.equal(quote({ signed: true, gold: true, invite: null }).total, 300);
});

test("invitación de firma: párrafo y firma gratis, el dorado se paga", () => {
  assert.equal(quote({ signed: true, gold: false, invite: "firma" }).total, 0);
  const q = quote({ signed: true, gold: true, invite: "firma" });
  assert.equal(q.total, 100);
  assert.equal(q.covered, 200);
});

test("invitación de oro: todo gratis", () => {
  assert.equal(quote({ signed: true, gold: true, invite: "oro" }).total, 0);
});

test("formato de euros", () => {
  assert.equal(euros(100).replace(/\s/g, " "), "1,00 €");
});
