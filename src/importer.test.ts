import test from "node:test";
import assert from "node:assert/strict";
import { mapRows, normalizeHeader, normalizePhone, validForImport } from "./importer.js";

test("normaliza cabeçalhos com acentos e separadores", () => {
  assert.equal(normalizeHeader("Data_Exportacao"), "data exportacao");
  assert.equal(normalizeHeader("E-mail"), "e mail");
});

test("normaliza telefone brasileiro e recusa número curto", () => {
  assert.equal(normalizePhone("+55 (13) 99720-5579"), "5513997205579");
  assert.equal(normalizePhone("13 3821-6768"), "551338216768");
  assert.equal(normalizePhone("123"), null);
});

test("mapeia a exportação Empresas e exige nome e telefone válido", () => {
  const rows = mapRows(
    ["Nome", "Endereço", "Telefone", "E-mail", "Rating", "Avaliações", "Website", "WhatsApp", "Status", "Categoria", "Tipos", "Data_Exportacao", "Hora_Exportacao"],
    [["Loja Teste", "Rua Um", "+55 13 99720-5579", "teste@exemplo.com", "4.5", "17", "site.test", "Não Verificado", "Aberto", "Lanches", "delivery", "22/09/2026", "23:02:25"]],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone_normalized, "5513997205579");
  assert.equal(rows[0].email, "teste@exemplo.com");
  assert.equal(rows[0].whatsapp, "+55 13 99720-5579");
  assert.equal(rows[0].category, "Lanches");
  assert.equal(validForImport(rows[0]), true);
  assert.equal(validForImport({ ...rows[0], phone_normalized: null }), false);
});
