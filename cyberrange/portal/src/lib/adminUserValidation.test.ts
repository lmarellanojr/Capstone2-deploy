import { toCreateUserInput, validateCreateUser, type CreateUserForm } from "./adminUserValidation"

const base: CreateUserForm = {
  username: "jdelacruz",
  email: "",
  first_name: "",
  last_name: "",
  role: "student",
  password: "correct-horse",
  temporary_password: true,
}

describe("validateCreateUser (mirrors users_router.CreateUserRequest)", () => {
  it("accepts a minimal valid student", () => {
    expect(validateCreateUser(base)).toEqual({})
  })

  it.each(["", "JDelaCruz", "-starts-with-dash", "has space", "a".repeat(33)])(
    "rejects username %p",
    (username) => {
      expect(validateCreateUser({ ...base, username }).username).toBeDefined()
    }
  )

  it.each(["a", "a1", "j.dela-cruz_2", "a".repeat(32)])("accepts username %p", (username) => {
    expect(validateCreateUser({ ...base, username }).username).toBeUndefined()
  })

  it("treats email as optional but validates it when given", () => {
    expect(validateCreateUser({ ...base, email: "" }).email).toBeUndefined()
    expect(validateCreateUser({ ...base, email: "not-an-email" }).email).toBeDefined()
    expect(validateCreateUser({ ...base, email: "j@mmdc.edu" }).email).toBeUndefined()
  })

  it("enforces the 8–128 password length", () => {
    expect(validateCreateUser({ ...base, password: "short" }).password).toBeDefined()
    expect(validateCreateUser({ ...base, password: "x".repeat(129) }).password).toBeDefined()
    expect(validateCreateUser({ ...base, password: "x".repeat(8) }).password).toBeUndefined()
  })
})

describe("toCreateUserInput", () => {
  it("omits blank optional fields, since the backend forbids extra/empty values", () => {
    expect(toCreateUserInput({ ...base, username: "  jdelacruz " })).toEqual({
      username: "jdelacruz",
      role: "student",
      password: "correct-horse",
      temporary_password: true,
    })
  })

  it("includes trimmed optional fields when present", () => {
    const body = toCreateUserInput({ ...base, email: " j@mmdc.edu ", first_name: "Juan", last_name: " Dela Cruz" })
    expect(body).toMatchObject({ email: "j@mmdc.edu", first_name: "Juan", last_name: "Dela Cruz" })
  })
})
