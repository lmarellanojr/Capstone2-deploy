import type { AdminUser } from "@/lib/api";

export type CredentialFeedback = { kind: "success" | "error"; message: string };

export function createCredentialFeedback(user: AdminUser, roleLabel: string): CredentialFeedback {
  if (user.credential_email_status === "failed") {
    return {
      kind: "error",
      message: `Created ${user.username}, but the credential email could not be sent. Check email settings, then use Reset password to send fresh temporary credentials.`,
    };
  }
  return {
    kind: "success",
    message: `Created ${user.username} (${roleLabel}).${user.credential_email_status === "sent" ? " Temporary credentials were emailed." : ""}`,
  };
}

export function resetCredentialFeedback(user: AdminUser, temporary: boolean): CredentialFeedback {
  if (user.credential_email_status === "failed") {
    return {
      kind: "error",
      message: `${user.username}'s password was reset, but the email could not be sent. Check email settings, then reset it again with a fresh temporary password.`,
    };
  }
  if (user.credential_email_status === "sent") {
    return {
      kind: "success",
      message: `${user.username}'s temporary credentials were emailed. They'll choose a new password at first sign-in.`,
    };
  }
  return {
    kind: "success",
    message: temporary
      ? `${user.username}'s password was reset. They'll choose a new one at next sign-in.`
      : `${user.username}'s password was reset.`,
  };
}
