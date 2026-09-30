// Client-side mirror of users_router.CreateUserRequest, so an admin sees what
// is wrong before submitting. The backend stays the authority (it re-validates
// everything and also applies the Keycloak password policy, which can still
// reject a password that passes here).

import type { AppRole, CreateUserInput } from "@/lib/api"

// users_router.USERNAME_PATTERN: lower-case only, because the username becomes
// the student_id used in LXD instance names (pod-{student_id}-kali).
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,31}$/
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
export const NAME_MAX = 64
export const EMAIL_MAX = 254

export const APP_ROLES: AppRole[] = ["student", "instructor", "admin"]

export interface CreateUserForm {
  username: string
  email: string
  first_name: string
  last_name: string
  role: AppRole
  password: string
  temporary_password: boolean
}

export type CreateUserErrors = Partial<Record<keyof CreateUserForm, string>>

export function validateCreateUser(form: CreateUserForm): CreateUserErrors {
  const errors: CreateUserErrors = {}
  const username = form.username.trim()
  if (!username) errors.username = "Username is required."
  else if (!USERNAME_PATTERN.test(username))
    errors.username = "Use 1–32 lower-case letters, digits, dot, dash or underscore, starting with a letter or digit."

  const email = form.email.trim()
  if (email && (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX)) errors.email = "Enter a valid email address."

  if (form.first_name.trim().length > NAME_MAX) errors.first_name = `At most ${NAME_MAX} characters.`
  if (form.last_name.trim().length > NAME_MAX) errors.last_name = `At most ${NAME_MAX} characters.`

  if (!APP_ROLES.includes(form.role)) errors.role = "Choose a role."

  if (form.password.length < PASSWORD_MIN) errors.password = `At least ${PASSWORD_MIN} characters.`
  else if (form.password.length > PASSWORD_MAX) errors.password = `At most ${PASSWORD_MAX} characters.`

  return errors
}

/** The exact request body: optional fields omitted when blank (the backend
 *  forbids unknown keys, and an empty-string email would fail its pattern). */
export function toCreateUserInput(form: CreateUserForm): CreateUserInput {
  const body: CreateUserInput = {
    username: form.username.trim(),
    role: form.role,
    password: form.password,
    temporary_password: form.temporary_password,
  }
  if (form.email.trim()) body.email = form.email.trim()
  if (form.first_name.trim()) body.first_name = form.first_name.trim()
  if (form.last_name.trim()) body.last_name = form.last_name.trim()
  return body
}
