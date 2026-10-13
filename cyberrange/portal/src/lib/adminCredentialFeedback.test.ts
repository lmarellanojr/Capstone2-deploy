import { createCredentialFeedback, resetCredentialFeedback } from "./adminCredentialFeedback";
import type { AdminUser } from "@/lib/api";

const user: AdminUser = {
  id: "u1", username: "student_demo", email: "student@example.test", first_name: null,
  last_name: null, enabled: true, role: "student", roles: ["student"], created_at: null,
};

test("creation tells the Admin to share login details securely", () => {
  const feedback = createCredentialFeedback(user, "Student");
  expect(feedback.message).toMatch(/approved secure channel/);
  expect(feedback.message).not.toMatch(/email/i);
});

test("temporary and permanent password resets explain the secure handoff", () => {
  expect(resetCredentialFeedback(user, true).message).toMatch(/choose a new password at next sign-in/);
  expect(resetCredentialFeedback(user, true).message).toMatch(/approved secure channel/);
  expect(resetCredentialFeedback(user, false).message).toMatch(/approved secure channel/);
});
