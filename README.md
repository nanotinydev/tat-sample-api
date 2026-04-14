# Sample API — tat Demo

A self-contained mock API server with [`tat`](https://www.npmjs.com/package/@nanotiny/tiny-api-test) test files that demonstrate every major `tat-cli` feature.

This project is designed to run **standalone** — clone it, open it in [StackBlitz](https://stackblitz.com), or drop it anywhere on disk. There's no build step and no dependency to install for the server itself; it uses Node's built-in `node:http`. The bundled `package.json` exists only to mark the project as ESM (`"type": "module"`) and to provide convenient `npm` scripts.

## Quick Start

All commands below run from **this folder** (`sample-api/`) — no repo root required.

```bash
# Terminal 1 — start the mock server
npm start
# (equivalent to: node server.js)

# Terminal 2 — run all tests
npm test
# (equivalent to: npx @nanotiny/tiny-api-test run tests/)
```

> **Note:** The server stores all data in memory. Some test files (e.g. `auth-flow.tat.yml`) use hardcoded emails, so they will fail on a second run if the server is still holding state from the first run. **Restart the server** before re-running tests to get a clean slate.

Or call the CLI directly for finer control:

```bash
# Run a single file
npx @nanotiny/tiny-api-test run tests/auth-flow.tat.yml

# Run only smoke-tagged suites
npx @nanotiny/tiny-api-test run tests/ --tag smoke

# Run the full project management flow
npx @nanotiny/tiny-api-test run tests/project-management-flow.tat.yml
```

## What the Server Provides

A project management API with linked entities: users, workspaces, projects, tasks, and comments. All data lives in memory — restart the server for a clean state.

### Endpoints

| Group | Endpoints |
|-------|-----------|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Workspaces | `POST /workspaces`, `GET /workspaces`, `GET /workspaces/:id`, `POST /workspaces/:id/members`, `GET /workspaces/:id/members` |
| Projects | `POST /workspaces/:id/projects`, `GET /workspaces/:id/projects`, `GET /projects/:id`, `PATCH /projects/:id`, `DELETE /projects/:id` |
| Tasks | `POST /projects/:id/tasks`, `GET /projects/:id/tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`, `DELETE /tasks/:id`, `POST /tasks/:id/assign`, `POST /tasks/:id/complete` |
| Comments | `POST /tasks/:id/comments`, `GET /tasks/:id/comments`, `DELETE /comments/:id` |
| Queries | `GET /tasks?status=open`, `?priority=high`, `?assignee=me`, `?search=login`, `?page=1&pageSize=10`, `?sortBy=createdAt&sortDirection=desc` |

## Test Files

| File | tat Features Demonstrated |
|------|--------------------------|
| `auth-flow.tat.yml` | Full auth lifecycle flow — register, login, token refresh, logout. Capture chaining, `$headers` assertion, `response: true`, error cases |
| `project-management-flow.tat.yml` | End-to-end project management — `setup` hook, workspace/project/task CRUD, comments, `response: { body: true }`, `timeout`, `$duration`, cross-suite capture chaining |
| `task-queries-flow.tat.yml` | Task query features — `setup` hook, filter/search/pagination/sort via query params, `contains` assertions |

## How the Setup Hook Works

Flow test files that need pre-authenticated access use:

```yaml
setup: node scripts/get-token.js
```

> The `scripts/` folder lives inside `tests/`, so the path is straightforward — `tat` runs `setup` commands with their working directory set to **the folder containing the `.tat.yml` file**.

The script calls `POST /auth/register` and `POST /auth/login`, then prints JSON to stdout:

```json
{ "token": "...", "userId": "...", "userName": "...", "userEmail": "..." }
```

`tat` merges this into the test environment so `{{token}}`, `{{userId}}`, etc. are available in all tests.

## Configuration

The server listens on port `3000` by default. Override with the `PORT` environment variable:

```bash
PORT=4000 node server.js
```

If you change the port, also update `tests/env.json`:

```json
{ "baseUrl": "http://localhost:4000" }
```

The setup script reads `BASE_URL` from its own environment if you need to point it at a non-default port:

```bash
BASE_URL=http://localhost:4000 npx @nanotiny/tiny-api-test run tests/auth.tat.yml
```

## Running on StackBlitz

1. Open the `sample-api/` folder as a StackBlitz project (Node template).
2. In one terminal: `npm start`
3. In another terminal: `npm test`

No `npm install` is required for the server itself. StackBlitz will install `@nanotiny/tiny-api-test` on first `npx` invocation (the `test` script uses `npx -y` so it accepts the prompt automatically).
