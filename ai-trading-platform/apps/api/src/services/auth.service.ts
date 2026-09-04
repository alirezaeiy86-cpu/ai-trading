import bcrypt from 'bcryptjs';

// =============================================================================
// AUTH SERVICE
// Single-user system — no user table. The dashboard password is set via
// DASHBOARD_PASSWORD env var and stored as a bcrypt hash in memory.
// JWT is issued on successful login and stored in a signed httpOnly cookie.
// =============================================================================

let _hashedPassword: string | null = null;

/**
 * Initialise the hashed password from the env var at startup.
 * Call once before the server starts accepting requests.
 */
export async function initAuthService(plainPassword: string): Promise<void> {
  _hashedPassword = await bcrypt.hash(plainPassword, 12);
}

/**
 * Verify a login attempt. Returns true if the password matches.
 */
export async function verifyPassword(candidate: string): Promise<boolean> {
  if (!_hashedPassword) {
    throw new Error('Auth service not initialised');
  }
  return bcrypt.compare(candidate, _hashedPassword);
}
