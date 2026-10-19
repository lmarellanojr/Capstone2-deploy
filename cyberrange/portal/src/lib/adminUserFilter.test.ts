import { filterAdminUsers } from "./adminUserFilter";
import type { AdminUser } from "@/lib/api";

const base: AdminUser = {
  id: "", username: "", email: null, first_name: null,
  last_name: null, enabled: true, role: "student", roles: ["student"], created_at: null,
};
const users: AdminUser[] = [
  { ...base, id: "1", username: "stu_on" },
  { ...base, id: "2", username: "stu_off", enabled: false },
  { ...base, id: "3", username: "admin_on", role: "admin", roles: ["admin"] },
  { ...base, id: "4", username: "inst_off", role: "instructor", roles: ["instructor"], enabled: false },
  { ...base, id: "5", username: "norole", role: null, roles: [] },
];
const names = (list: AdminUser[]) => list.map((u) => u.username);

test("all/all returns every user", () => {
  expect(filterAdminUsers(users, "all", "all")).toHaveLength(users.length);
});

test("filters by role, including users with no role", () => {
  expect(names(filterAdminUsers(users, "student", "all"))).toEqual(["stu_on", "stu_off"]);
  expect(names(filterAdminUsers(users, "none", "all"))).toEqual(["norole"]);
});

test("filters by status and combines with role", () => {
  expect(names(filterAdminUsers(users, "all", "disabled"))).toEqual(["stu_off", "inst_off"]);
  expect(names(filterAdminUsers(users, "student", "active"))).toEqual(["stu_on"]);
});

test("filters instructors and admins", () => {
  expect(names(filterAdminUsers(users, "instructor", "all"))).toEqual(["inst_off"]);
  expect(names(filterAdminUsers(users, "admin", "all"))).toEqual(["admin_on"]);
  expect(names(filterAdminUsers(users, "admin", "disabled"))).toEqual([]);
});

test("'none' combines with status", () => {
  expect(names(filterAdminUsers(users, "none", "active"))).toEqual(["norole"]);
  expect(names(filterAdminUsers(users, "none", "disabled"))).toEqual([]);
});

test("kept ids stay visible even when they no longer match", () => {
  const keep = new Set(["1", "5"]);
  expect(names(filterAdminUsers(users, "admin", "disabled", keep))).toEqual(["stu_on", "norole"]);
  expect(names(filterAdminUsers(users, "student", "disabled", keep))).toEqual(["stu_on", "stu_off", "norole"]);
});
