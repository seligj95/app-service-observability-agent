const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Load app configuration
// BUG DEMO: Change 'config.json' to 'config-v2.json' to simulate a deployment bug
//           (config-v2.json doesn't exist, causing the app to crash on startup)
const config = require('./config-dne.json');
console.log(`[INFO] Loaded config for ${config.appName} v${config.version}`);

// Simple in-memory todo storage
let todos = [
  { id: 1, title: 'Learn Azure App Service', completed: true },
  { id: 2, title: 'Set up Log Analytics', completed: true },
  { id: 3, title: 'Demo MCP observability tools', completed: false },
];

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('[INFO] Health check requested');
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Home page
app.get('/', (req, res) => {
  console.log('[INFO] Home page requested');
  res.json({
    name: config.appName,
    version: config.version,
    endpoints: {
      'GET /': 'This info',
      'GET /health': 'Health check',
      'GET /todos': 'List all todos',
      'POST /todos': 'Create a todo',
      'GET /todos/:id': 'Get a todo',
      'PUT /todos/:id': 'Update a todo',
      'DELETE /todos/:id': 'Delete a todo',
    }
  });
});

// List all todos
app.get('/todos', (req, res) => {
  console.log('[INFO] Listing all todos');
  res.json(todos);
});

// Get a single todo
app.get('/todos/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const todo = todos.find(t => t.id === id);
  
  if (!todo) {
    console.log(`[WARN] Todo ${id} not found`);
    return res.status(404).json({ error: 'Todo not found' });
  }
  
  console.log(`[INFO] Retrieved todo ${id}`);
  res.json(todo);
});

// Create a new todo
app.post('/todos', (req, res) => {
  const { title } = req.body;
  
  if (!title) {
    console.log('[ERROR] Missing title in request');
    return res.status(400).json({ error: 'Title is required' });
  }
  
  const newTodo = {
    id: todos.length > 0 ? Math.max(...todos.map(t => t.id)) + 1 : 1,
    title,
    completed: false
  };
  
  todos.push(newTodo);
  console.log(`[INFO] Created todo ${newTodo.id}: ${title}`);
  res.status(201).json(newTodo);
});

// Update a todo
app.put('/todos/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const todo = todos.find(t => t.id === id);
  
  if (!todo) {
    console.log(`[WARN] Todo ${id} not found for update`);
    return res.status(404).json({ error: 'Todo not found' });
  }
  
  const { title, completed } = req.body;
  if (title !== undefined) todo.title = title;
  if (completed !== undefined) todo.completed = completed;
  
  console.log(`[INFO] Updated todo ${id}`);
  res.json(todo);
});

// Delete a todo
app.delete('/todos/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = todos.findIndex(t => t.id === id);
  
  if (index === -1) {
    console.log(`[WARN] Todo ${id} not found for deletion`);
    return res.status(404).json({ error: 'Todo not found' });
  }
  
  todos.splice(index, 1);
  console.log(`[INFO] Deleted todo ${id}`);
  res.status(204).send();
});

app.listen(port, () => {
  console.log(`[INFO] ${config.appName} listening on port ${port}`);
});
