const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const APP_DIR = path.resolve(BACKEND_DIR, '..');
const BUNDLE_FILE = path.join(BACKEND_DIR, 'build', 'server.js');
const APP_FILES = [
  'app.yaml',
  'start.sh',
  'dbx_inspire_ai_agent.ipynb',
  'dbx_generate_demo_data.py',
  'dbx_inspire_after_demo.py',
  'backend/build',
  'backend/api-docs.html',
  'backend/openapi.yaml',
  'backend/notebook_bundle.js',
  'backend/demo_notebook_bundle.js',
  'backend/dbx_generate_demo_data.py',
  'frontend/dist',
];
const APP_FILES_WHEN_PRESENT = ['backend/showcase'];

module.exports = { APP_DIR, APP_FILES, APP_FILES_WHEN_PRESENT, BACKEND_DIR, BUNDLE_FILE };
