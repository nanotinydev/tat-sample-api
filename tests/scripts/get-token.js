/**
 * Setup hook script for tat test files.
 * Registers a unique user and logs in, then prints auth env as JSON to stdout.
 *
 * Usage in a .tat.yml file (path is relative to the .tat.yml file's directory):
 *   setup: node ../scripts/get-token.js
 *
 * Outputs: { "token": "...", "userId": "...", "userName": "...", "userEmail": "..." }
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const email = `testuser-${Date.now()}@example.com`;
const password = 'test-password-123';
const name = 'Test User';

async function main() {
  // Register
  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!regRes.ok) {
    const err = await regRes.json();
    throw new Error(`Register failed: ${err.error}`);
  }

  // Login
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    const err = await loginRes.json();
    throw new Error(`Login failed: ${err.error}`);
  }
  const { token, user } = await loginRes.json();

  // Output JSON for tat to merge into env
  console.log(JSON.stringify({
    token,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  }));
}

main().catch(err => {
  process.stderr.write(`get-token.js error: ${err.message}\n`);
  process.exit(1);
});
