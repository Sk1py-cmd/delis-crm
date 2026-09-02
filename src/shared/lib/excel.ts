import writeXlsxFile, { type SheetData } from "write-excel-file/browser";

const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

/** Prevent spreadsheet applications from interpreting exported customer text as a formula. */
export function safeExcelText(value: string) {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function safeFilename(filename: string) {
  return filename
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "delis-export";
}

export function exportXLSX(headers: string[], rows: (string | number)[][], filename: string) {
  const data: SheetData = [
    headers.map(safeExcelText),
    ...rows.map((row) => row.map((value) => (typeof value === "string" ? safeExcelText(value) : value))),
  ];
  const columns = headers.map((header, index) => {
    const maxLength = Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length));
    return { width: Math.min(Math.max(maxLength + 2, 10), 50) };
  });

  return writeXlsxFile(data, { sheet: "Данные", columns }).toFile(`${safeFilename(filename)}.xlsx`);
}
