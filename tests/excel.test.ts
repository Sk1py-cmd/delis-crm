import assert from "node:assert/strict";
import test from "node:test";
import { safeExcelText } from "@/shared/lib/excel";

test("spreadsheet exports escape formula-looking text", () => {
  assert.equal(safeExcelText("=HYPERLINK(\"https://example.test\")"), "'=HYPERLINK(\"https://example.test\")");
  assert.equal(safeExcelText(" \t-1+1"), "' \t-1+1");
  assert.equal(safeExcelText("+998 90 123 45 67"), "'+998 90 123 45 67");
  assert.equal(safeExcelText("Обычный текст"), "Обычный текст");
});
