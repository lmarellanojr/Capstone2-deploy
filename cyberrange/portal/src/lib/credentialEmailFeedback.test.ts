import { createCredentialFeedback, resetCredentialFeedback } from "./credentialEmailFeedback";
import type { AdminUser } from "./api";

const user = (credential_email_status: AdminUser["credential_email_status"]): AdminUser => ({
  id: "u1", username: "student_demo", email: "student@example.test",
  first_name: null, last_name: null, enabled: true, role: "student",
  roles: ["student"], created_at: null, credential_email_status,
});

test("create feedback reports sent, failed, and skipped honestly", () => {
  expect(createCredentialFeedback(user("sent"), "Student")).toEqual({
    kind: "success", message: expect.stringContaining("Temporary credentials were emailed"),
  });
  expect(createCredentialFeedback(user("failed"), "Student")).toEqual({
    kind: "error", message: expect.stringContaining("use Reset password"),
  });
  expect(createCredentialFeedback(user("skipped"), "Student").message).not.toContain("emailed");
});

test("reset feedback names recovery and never claims permanent credentials were emailed", () => {
  expect(resetCredentialFeedback(user("failed"), true)).toEqual({
    kind: "error", message: expect.stringContaining("fresh temporary password"),
  });
  expect(resetCredentialFeedback(user("sent"), true).message).toContain("were emailed");
  expect(resetCredentialFeedback(user("skipped"), false).message).not.toContain("emailed");
});
