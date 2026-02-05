const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Check if bug mode is enabled via environment variable
const ENABLE_BUG = process.env.ENABLE_BUG === 'true';

// This will crash the app if ENABLE_BUG is true
// The file config-v2.json doesn't exist!
if (ENABLE_BUG) {
  console.log('[DEMO] Bug mode enabled - attempting to load missing config...');
  const config = require('./config-v2.json');
}

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
    name: 'Demo Todo App',
    version: '1.0.0',
    bugMode: ENABLE_BUG,
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
  console.log(`[INFO] Demo Todo App listening on port ${port}`);
  console.log(`[INFO] Bug mode: ${ENABLE_BUG ? 'ENABLED' : 'disabled'}`);
});
