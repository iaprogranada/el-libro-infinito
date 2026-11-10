import assert from "node:assert/strict";
import { test } from "node:test";
import { checkForm, normalizeInvite, normalizeText, quickReject } from "../src/lib/validation.ts";

test("normaliza espacios y saltos de línea", () => {
  assert.equal(normalizeText("  Hola   mundo \n\n\n\n adiós  "), "Hola mundo\n\nadiós");
  assert.equal(normalizeText("a\u200Bb"), "ab");
});

test("códigos de invitación en mayúsculas y sin espacios", () => {
  assert.equal(normalizeInvite(" libro-abcd-efgh "), "LIBRO-ABCD-EFGH");
  assert.equal(normalizeInvite(""), null);
});

test("comprueba el formulario", () => {
  assert.match(checkForm("a", "texto") ?? "", /al menos 2/);
  assert.match(checkForm("banana loca", "") ?? "", /Escribe tu párrafo/);
  assert.match(checkForm("banana loca", "x".repeat(501)) ?? "", /501/);
  assert.equal(checkForm("Lucía_desde_Lima", "Y entonces…"), null);
  assert.ok(checkForm("<script>", "hola"));
});

test("el filtro rápido para lo evidente", () => {
  assert.ok(quickReject("pepe", "visita www.mitienda.com"));
  assert.ok(quickReject("pepe", "sígueme en @pepe_oficial"));
  assert.ok(quickReject("pepe", "eres un gilipollas"));
  assert.ok(quickReject("pepe", "te voy a matar"));
});

test("el filtro rápido no molesta a la historia", () => {
  assert.equal(quickReject("Jordi_Tarragona", "Una brújula que no señalaba el norte. Un reloj sin agujas."), null);
  assert.equal(quickReject("Kenji_Tokyo", "I NEED to know what is in the backpack."), null);
  assert.equal(quickReject("Paqui", "Las sardinas las ponían buenísimas en Almería."), null);
});
