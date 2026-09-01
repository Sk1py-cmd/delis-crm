import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { rejectForeignWrite } from "@/server/request";

function request(headers: Record<string, string>) {
  return new NextRequest("https://crm.example.uz/api/manage", { method: "POST", headers });
}

test("same-origin writes accept the forwarded HTTPS host", () => {
  const result = rejectForeignWrite(request({
    origin: "https://crm.example.uz",
    host: "app:3000",
    "x-forwarded-host": "crm.example.uz",
    "x-forwarded-proto": "https",
  }));
  assert.equal(result, null);
});

test("cross-origin writes and malformed proxy origins are rejected", () => {
  const foreign = rejectForeignWrite(request({
    origin: "https://attacker.example",
    host: "crm.example.uz",
    "x-forwarded-proto": "https",
  }));
  assert.equal(foreign?.status, 403);

  const protocolMismatch = rejectForeignWrite(request({
    origin: "https://crm.example.uz",
    host: "crm.example.uz",
    "x-forwarded-proto": "http",
  }));
  assert.equal(protocolMismatch?.status, 403);

  assert.equal(rejectForeignWrite(request({ host: "crm.example.uz" })), null);
});
