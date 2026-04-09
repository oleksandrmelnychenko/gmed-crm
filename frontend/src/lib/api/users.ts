import { get, post, postNoBody } from "./client";
import type {
  User,
  CreateUserBody,
  UpdateUserBody,
  ActiveSession,
  AssignableUser,
} from "./types";

export function fetchUsers(): Promise<User[]> {
  return get<User[]>("/users");
}

export function fetchAssignableUsers(): Promise<AssignableUser[]> {
  return get<AssignableUser[]>("/users?assignable_only=true&active_only=true");
}

export function fetchOnlineUsers(): Promise<ActiveSession[]> {
  return get<ActiveSession[]>("/users/online");
}

export function createUser(body: CreateUserBody): Promise<User> {
  return post<User>("/users", body);
}

export function updateUser(id: string, body: UpdateUserBody): Promise<unknown> {
  return post(`/users/${id}/update`, body);
}

export function resetPassword(id: string, newPassword: string): Promise<unknown> {
  return post(`/users/${id}/reset-password`, { new_password: newPassword });
}

export function activateUser(id: string): Promise<void> {
  return postNoBody(`/users/${id}/activate`);
}

export function deactivateUser(id: string): Promise<void> {
  return postNoBody(`/users/${id}/deactivate`);
}
