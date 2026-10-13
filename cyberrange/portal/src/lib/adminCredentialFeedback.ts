import type { AdminUser } from "@/lib/api";

export type CredentialFeedback = { kind: "success"; message: string };

export function createCredentialFeedback(user: AdminUser, roleLabel: string): CredentialFeedback {
  return {
    kind: "success",
    message: `Created ${user.username} (${roleLabel}). Share login details through your approved secure channel.`,
  };
}

export function resetCredentialFeedback(user: AdminUser, temporary: boolean): CredentialFeedback {
  return {
    kind: "success",
    message: temporary
      ? `${user.username}'s password was reset. Share it through your approved secure channel; they'll choose a new password at next sign-in.`
      : `${user.username}'s password was reset. Share it through your approved secure channel.`,
  };
}
