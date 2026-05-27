export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
}

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 12) errors.push('password must be at least 12 characters');
  if (!/[a-z]/.test(password)) errors.push('password must include a lowercase letter');
  if (!/[A-Z]/.test(password)) errors.push('password must include an uppercase letter');
  if (!/[0-9]/.test(password)) errors.push('password must include a number');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('password must include a symbol');
  return { ok: errors.length === 0, errors };
}
