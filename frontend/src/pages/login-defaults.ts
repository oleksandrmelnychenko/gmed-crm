type LoginDefaultsInput = {
  enabled: boolean;
  email?: string;
  password?: string;
};

export type LoginDefaults = {
  email: string;
  password: string;
};

export function resolveLoginDefaults({
  enabled,
  email,
  password,
}: LoginDefaultsInput): LoginDefaults {
  if (!enabled) {
    return { email: "", password: "" };
  }

  return {
    email: email ?? "",
    password: password ?? "",
  };
}

export function getBuildLoginDefaults(): LoginDefaults {
  return resolveLoginDefaults({
    enabled:
      import.meta.env.DEV ||
      import.meta.env.VITE_ENABLE_DEV_LOGIN_DEFAULTS === "true",
    email: import.meta.env.VITE_DEV_LOGIN_EMAIL,
    password: import.meta.env.VITE_DEV_LOGIN_PASSWORD,
  });
}
