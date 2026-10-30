"use server";

import { login, logout, register } from "@/lib/auth";

export async function registerAction(input: { name: string; password: string; code: string }) {
  return register(input);
}

export async function loginAction(input: { name: string; password: string }) {
  return login(input);
}

export async function logoutAction() {
  await logout();
}
