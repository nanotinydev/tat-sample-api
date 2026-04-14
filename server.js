import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------
const users = new Map();
const tokens = new Map();       // token -> userId
const refreshTokens = new Map(); // refreshToken -> userId
const workspaces = new Map();
const projects = new Map();
const tasks = new Map();
const comments = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const now = () => new Date().toISOString();

function json(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => (buf += c));
    req.on('end', () => {
      if (!buf) return resolve(undefined);
      try { resolve(JSON.parse(buf)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function authenticate(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const userId = tokens.get(token);
  if (!userId) return null;
  return users.get(userId) || null;
}

function paginate(items, query) {
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(query.get('pageSize') || '20', 10) || 20));
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { data: items.slice(start, start + pageSize), total, page, pageSize };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
// Each route: [method, pattern, handler]
// Pattern uses :param for path params
const routes = [];

function route(method, pattern, handler) {
  const paramNames = [];
  const re = new RegExp(
    '^' +
    pattern.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    }) +
    '$',
  );
  routes.push({ method, re, paramNames, handler });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (!m) continue;
    const params = {};
    r.paramNames.forEach((name, i) => (params[name] = m[i + 1]));
    return { handler: r.handler, params };
  }
  return null;
}

// ---------------------------------------------------------------------------
// AUTH routes
// ---------------------------------------------------------------------------
route('POST', '/auth/register', async (req, res, _params, body) => {
  if (!body?.email || !body?.password || !body?.name) {
    return json(res, 400, { error: 'email, password, and name are required' });
  }
  for (const u of users.values()) {
    if (u.email === body.email) return json(res, 409, { error: 'Email already registered' });
  }
  const user = { id: randomUUID(), email: body.email, name: body.name, password: body.password, createdAt: now() };
  users.set(user.id, user);
  const { password, ...safe } = user;
  json(res, 201, safe);
});

route('POST', '/auth/login', async (req, res, _params, body) => {
  if (!body?.email || !body?.password) {
    return json(res, 400, { error: 'email and password are required' });
  }
  let found = null;
  for (const u of users.values()) {
    if (u.email === body.email && u.password === body.password) { found = u; break; }
  }
  if (!found) return json(res, 401, { error: 'Invalid credentials' });

  const token = randomUUID();
  const refreshToken = randomUUID();
  tokens.set(token, found.id);
  refreshTokens.set(refreshToken, found.id);

  const { password, ...safe } = found;
  json(res, 200, { token, refreshToken, expiresIn: 3600, user: safe });
});

route('POST', '/auth/refresh', async (req, res, _params, body) => {
  if (!body?.refreshToken) return json(res, 400, { error: 'refreshToken is required' });
  const userId = refreshTokens.get(body.refreshToken);
  if (!userId) return json(res, 401, { error: 'Invalid refresh token' });

  refreshTokens.delete(body.refreshToken);
  const newToken = randomUUID();
  const newRefresh = randomUUID();
  tokens.set(newToken, userId);
  refreshTokens.set(newRefresh, userId);
  json(res, 200, { token: newToken, refreshToken: newRefresh, expiresIn: 3600 });
});

route('POST', '/auth/logout', async (req, res) => {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    tokens.delete(auth.slice(7));
  }
  json(res, 204);
});

route('GET', '/auth/me', async (req, res) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });
  const { password, ...safe } = user;
  json(res, 200, safe);
});

// ---------------------------------------------------------------------------
// WORKSPACE routes
// ---------------------------------------------------------------------------
route('POST', '/workspaces', async (req, res, _params, body) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });
  if (!body?.name) return json(res, 400, { error: 'name is required' });

  const ws = {
    id: randomUUID(),
    name: body.name,
    description: body.description || '',
    ownerId: user.id,
    members: [{ userId: user.id, role: 'owner', joinedAt: now() }],
    createdAt: now(),
    updatedAt: now(),
  };
  workspaces.set(ws.id, ws);
  json(res, 201, ws);
});

route('GET', '/workspaces', async (req, res) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const list = [...workspaces.values()].filter(ws =>
    ws.members.some(m => m.userId === user.id),
  );
  json(res, 200, { data: list, total: list.length });
});

route('GET', '/workspaces/:workspaceId', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const ws = workspaces.get(params.workspaceId);
  if (!ws) return json(res, 404, { error: 'Workspace not found' });
  json(res, 200, ws);
});

route('POST', '/workspaces/:workspaceId/members', async (req, res, params, body) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const ws = workspaces.get(params.workspaceId);
  if (!ws) return json(res, 404, { error: 'Workspace not found' });
  if (!body?.email || !body?.role) return json(res, 400, { error: 'email and role are required' });

  let target = null;
  for (const u of users.values()) {
    if (u.email === body.email) { target = u; break; }
  }
  if (!target) return json(res, 404, { error: 'User not found' });

  if (ws.members.some(m => m.userId === target.id)) {
    return json(res, 409, { error: 'User is already a member' });
  }

  const member = { userId: target.id, role: body.role, joinedAt: now() };
  ws.members.push(member);
  ws.updatedAt = now();
  json(res, 201, member);
});

route('GET', '/workspaces/:workspaceId/members', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const ws = workspaces.get(params.workspaceId);
  if (!ws) return json(res, 404, { error: 'Workspace not found' });
  json(res, 200, { data: ws.members, total: ws.members.length });
});

// ---------------------------------------------------------------------------
// PROJECT routes
// ---------------------------------------------------------------------------
route('POST', '/workspaces/:workspaceId/projects', async (req, res, params, body) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const ws = workspaces.get(params.workspaceId);
  if (!ws) return json(res, 404, { error: 'Workspace not found' });
  if (!body?.name) return json(res, 400, { error: 'name is required' });

  const project = {
    id: randomUUID(),
    workspaceId: ws.id,
    name: body.name,
    description: body.description || '',
    status: body.status || 'active',
    createdAt: now(),
    updatedAt: now(),
  };
  projects.set(project.id, project);
  json(res, 201, project);
});

route('GET', '/workspaces/:workspaceId/projects', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const ws = workspaces.get(params.workspaceId);
  if (!ws) return json(res, 404, { error: 'Workspace not found' });

  const list = [...projects.values()].filter(p => p.workspaceId === ws.id);
  json(res, 200, { data: list, total: list.length });
});

route('GET', '/projects/:projectId', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const project = projects.get(params.projectId);
  if (!project) return json(res, 404, { error: 'Project not found' });
  json(res, 200, project);
});

route('PATCH', '/projects/:projectId', async (req, res, params, body) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const project = projects.get(params.projectId);
  if (!project) return json(res, 404, { error: 'Project not found' });

  if (body?.name !== undefined) project.name = body.name;
  if (body?.description !== undefined) project.description = body.description;
  if (body?.status !== undefined) project.status = body.status;
  project.updatedAt = now();

  json(res, 200, project);
});

route('DELETE', '/projects/:projectId', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  if (!projects.has(params.projectId)) return json(res, 404, { error: 'Project not found' });
  projects.delete(params.projectId);
  // Also delete associated tasks and their comments
  for (const [tid, task] of tasks) {
    if (task.projectId === params.projectId) {
      for (const [cid, comment] of comments) {
        if (comment.taskId === tid) comments.delete(cid);
      }
      tasks.delete(tid);
    }
  }
  json(res, 204);
});

// ---------------------------------------------------------------------------
// TASK routes
// ---------------------------------------------------------------------------
route('POST', '/projects/:projectId/tasks', async (req, res, params, body) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const project = projects.get(params.projectId);
  if (!project) return json(res, 404, { error: 'Project not found' });
  if (!body?.title) return json(res, 400, { error: 'title is required' });

  const task = {
    id: randomUUID(),
    projectId: project.id,
    title: body.title,
    description: body.description || '',
    status: body.status || 'open',
    priority: body.priority || 'medium',
    assigneeId: body.assigneeId || null,
    tags: body.tags || [],
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
  };
  tasks.set(task.id, task);
  json(res, 201, task);
});

route('GET', '/projects/:projectId/tasks', async (req, res, params, _body, query) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const project = projects.get(params.projectId);
  if (!project) return json(res, 404, { error: 'Project not found' });

  let list = [...tasks.values()].filter(t => t.projectId === project.id);
  list = applyTaskFilters(list, query, user);
  json(res, 200, paginate(list, query));
});

route('GET', '/tasks/:taskId', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const task = tasks.get(params.taskId);
  if (!task) return json(res, 404, { error: 'Task not found' });
  json(res, 200, task);
});

route('GET', '/tasks', async (req, res, _params, _body, query) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  let list = [...tasks.values()];
  list = applyTaskFilters(list, query, user);
  json(res, 200, paginate(list, query));
});

route('PATCH', '/tasks/:taskId', async (req, res, params, body) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const task = tasks.get(params.taskId);
  if (!task) return json(res, 404, { error: 'Task not found' });

  if (body?.title !== undefined) task.title = body.title;
  if (body?.description !== undefined) task.description = body.description;
  if (body?.status !== undefined) task.status = body.status;
  if (body?.priority !== undefined) task.priority = body.priority;
  if (body?.assigneeId !== undefined) task.assigneeId = body.assigneeId;
  if (body?.tags !== undefined) task.tags = body.tags;
  task.updatedAt = now();

  json(res, 200, task);
});

route('DELETE', '/tasks/:taskId', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  if (!tasks.has(params.taskId)) return json(res, 404, { error: 'Task not found' });
  // Delete associated comments
  for (const [cid, comment] of comments) {
    if (comment.taskId === params.taskId) comments.delete(cid);
  }
  tasks.delete(params.taskId);
  json(res, 204);
});

route('POST', '/tasks/:taskId/assign', async (req, res, params, body) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const task = tasks.get(params.taskId);
  if (!task) return json(res, 404, { error: 'Task not found' });
  if (!body?.userId) return json(res, 400, { error: 'userId is required' });

  task.assigneeId = body.userId;
  task.updatedAt = now();
  json(res, 200, task);
});

route('POST', '/tasks/:taskId/complete', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const task = tasks.get(params.taskId);
  if (!task) return json(res, 404, { error: 'Task not found' });

  task.status = 'done';
  task.completedAt = now();
  task.updatedAt = now();
  json(res, 200, task);
});

// ---------------------------------------------------------------------------
// COMMENT routes
// ---------------------------------------------------------------------------
route('POST', '/tasks/:taskId/comments', async (req, res, params, body) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const task = tasks.get(params.taskId);
  if (!task) return json(res, 404, { error: 'Task not found' });
  if (!body?.text) return json(res, 400, { error: 'text is required' });

  const comment = {
    id: randomUUID(),
    taskId: task.id,
    userId: user.id,
    userName: user.name,
    text: body.text,
    createdAt: now(),
  };
  comments.set(comment.id, comment);
  json(res, 201, comment);
});

route('GET', '/tasks/:taskId/comments', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  const task = tasks.get(params.taskId);
  if (!task) return json(res, 404, { error: 'Task not found' });

  const list = [...comments.values()].filter(c => c.taskId === task.id);
  json(res, 200, { data: list, total: list.length });
});

route('DELETE', '/comments/:commentId', async (req, res, params) => {
  const user = authenticate(req);
  if (!user) return json(res, 401, { error: 'Unauthorized' });

  if (!comments.has(params.commentId)) return json(res, 404, { error: 'Comment not found' });
  comments.delete(params.commentId);
  json(res, 204);
});

// ---------------------------------------------------------------------------
// Task query helpers
// ---------------------------------------------------------------------------
function applyTaskFilters(list, query, currentUser) {
  const status = query.get('status');
  if (status) list = list.filter(t => t.status === status);

  const priority = query.get('priority');
  if (priority) list = list.filter(t => t.priority === priority);

  const assignee = query.get('assignee');
  if (assignee === 'me') {
    list = list.filter(t => t.assigneeId === currentUser.id);
  } else if (assignee) {
    list = list.filter(t => t.assigneeId === assignee);
  }

  const search = query.get('search');
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(t =>
      t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }

  const sortBy = query.get('sortBy') || 'createdAt';
  const sortDir = query.get('sortDirection') === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    const av = a[sortBy] ?? '';
    const bv = b[sortBy] ?? '';
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return 0;
  });

  return list;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3000', 10);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  const query = url.searchParams;

  const matched = matchRoute(method, pathname);
  if (!matched) return json(res, 404, { error: 'Not found' });

  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : undefined;
    await matched.handler(req, res, matched.params, body, query);
  } catch (err) {
    json(res, 500, { error: err.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Sample API server running on http://localhost:${PORT}`);
});
