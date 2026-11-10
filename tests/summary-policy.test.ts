import assert from "node:assert/strict";
import { test } from "node:test";
import { SUMMARY_MAX_WAIT_MS, SUMMARY_RATE_STEPS, shouldRefreshSummary, summaryBatchSize } from "../src/lib/summary-policy.ts";

test("norma general: cada 5 párrafos", () => {
  assert.equal(summaryBatchSize(0), 5);
  assert.equal(summaryBatchSize(3), 5);
  assert.equal(summaryBatchSize(50), 5);
});

test("el lote crece con el volumen del día", () => {
  assert.equal(summaryBatchSize(51), 10);
  assert.equal(summaryBatchSize(100), 10);
  assert.equal(summaryBatchSize(101), 20);
  assert.equal(summaryBatchSize(200), 20);
  assert.equal(summaryBatchSize(201), 50);
  assert.equal(summaryBatchSize(500), 50);
  assert.equal(summaryBatchSize(501), 100);
  assert.equal(summaryBatchSize(100_000), 100);
});

test("los umbrales de volumen son 50, 100, 200 y 500", () => {
  assert.deepEqual(SUMMARY_RATE_STEPS, [50, 100, 200, 500]);
});

test("se reescribe al completar el lote, no antes", () => {
  const recent = 60_000;
  assert.equal(shouldRefreshSummary({ pending: 0, every: 5, sinceLastRewriteMs: recent }), false);
  assert.equal(shouldRefreshSummary({ pending: 4, every: 5, sinceLastRewriteMs: recent }), false);
  assert.equal(shouldRefreshSummary({ pending: 5, every: 5, sinceLastRewriteMs: recent }), true);
  assert.equal(shouldRefreshSummary({ pending: 9, every: 10, sinceLastRewriteMs: recent }), false);
  assert.equal(shouldRefreshSummary({ pending: 12, every: 10, sinceLastRewriteMs: recent }), true);
});

test("si va lento, se reescribe igualmente una vez al día con lo que haya", () => {
  assert.equal(shouldRefreshSummary({ pending: 1, every: 5, sinceLastRewriteMs: SUMMARY_MAX_WAIT_MS }), true);
  assert.equal(shouldRefreshSummary({ pending: 0, every: 5, sinceLastRewriteMs: SUMMARY_MAX_WAIT_MS * 3 }), false);
});
