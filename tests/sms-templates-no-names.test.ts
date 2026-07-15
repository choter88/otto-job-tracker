/**
 * D13.1 minimum-necessary (164.502(b)): shipped SMS/message DEFAULT templates
 * must never interpolate patient names — these are desktop-only seed drafts
 * for client-side use, and Otto never transmits patient names through
 * Twilio. Users may still add {patient_first_name} etc. manually via the
 * template editor; this test only locks down the DEFAULTS Otto ships.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { getDefaultOfficeSettings } from "../shared/office-defaults";
import { DEFAULT_READY_FOR_PICKUP_TEMPLATE } from "../shared/message-template-defaults";

const FORBIDDEN_TOKENS = ["{patient_first_name}", "{patient_last_name}", "{patient_name}"];

function assertNoPatientNameTokens(label: string, template: string) {
  for (const token of FORBIDDEN_TOKENS) {
    assert.ok(
      !template.includes(token),
      `${label} must not contain ${token}, got: ${template}`,
    );
  }
}

test("getDefaultOfficeSettings().smsTemplates contain no patient-name tokens", () => {
  const { smsTemplates } = getDefaultOfficeSettings();
  for (const [statusId, template] of Object.entries(smsTemplates)) {
    assertNoPatientNameTokens(`smsTemplates.${statusId}`, template);
  }
});

test("getDefaultOfficeSettings().smsTemplates.job_created preserves {order_id}", () => {
  const { smsTemplates } = getDefaultOfficeSettings();
  assert.ok(
    smsTemplates.job_created.includes("{order_id}"),
    `job_created template must still reference {order_id}, got: ${smsTemplates.job_created}`,
  );
});

test("DEFAULT_READY_FOR_PICKUP_TEMPLATE contains no patient-name tokens", () => {
  assertNoPatientNameTokens("DEFAULT_READY_FOR_PICKUP_TEMPLATE", DEFAULT_READY_FOR_PICKUP_TEMPLATE);
});

test("DEFAULT_READY_FOR_PICKUP_TEMPLATE preserves {order_id}", () => {
  assert.ok(
    DEFAULT_READY_FOR_PICKUP_TEMPLATE.includes("{order_id}"),
    `DEFAULT_READY_FOR_PICKUP_TEMPLATE must still reference {order_id}, got: ${DEFAULT_READY_FOR_PICKUP_TEMPLATE}`,
  );
});
