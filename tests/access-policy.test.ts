import assert from "node:assert/strict";
import test from "node:test";
import {
  STAFF_ROLES,
  canAccess,
  canManageAction,
  hasCapability,
} from "@/shared/config/access";

test("Owner-only routes and credential actions cannot be delegated to staff", () => {
  assert.equal(canAccess("owner", "/reports"), true);
  assert.equal(canAccess("owner", "/security"), true);
  assert.equal(canAccess("owner", "/users"), true);
  assert.equal(hasCapability("owner", "security:manage"), true);
  assert.equal(canManageAction("owner", "createUser"), true);

  for (const role of STAFF_ROLES) {
    assert.equal(canAccess(role, "/reports"), false, `${role} must not access Owner reports`);
    assert.equal(canAccess(role, "/security"), false, `${role} must not manage sessions or TOTP`);
    assert.equal(canAccess(role, "/users"), false, `${role} must not manage employee accounts`);
    assert.equal(hasCapability(role, "security:manage"), false, `${role} must not call security mutations`);
    assert.equal(canManageAction(role, "createUser"), false, `${role} must not create accounts`);
    assert.equal(canManageAction(role, "resetPassword"), false, `${role} must not reset passwords`);
  }
});

test("customer consent operations stay available only to customer-facing staff roles", () => {
  for (const role of ["admin", "manager", "support", "operator"] as const) {
    assert.equal(canManageAction(role, "setCustomerMarketingConsent"), true);
  }
  for (const role of ["warehouse", "agent", "moderator"] as const) {
    assert.equal(canManageAction(role, "setCustomerMarketingConsent"), false);
  }
});
