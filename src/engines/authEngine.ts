export const DEV_ONLY_PASSWORD = "emrr-dev";

export function validateDevPassword(password: string): boolean {
  // Development-only local gate. No real authentication, tokens, sessions, or backend calls.
  return password === DEV_ONLY_PASSWORD;
}
