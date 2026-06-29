const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Use a base directory for all test workspaces within the OS's temporary directory
const TEST_RUN_ID = crypto.randomBytes(8).toString('hex');
const BASE_WORKSPACES_DIR = path.join(os.tmpdir(), `actions-generate-licenses-test-${TEST_RUN_ID}`);

// Create a unique workspace directory for each test file that imports this helper.
// This ensures isolation between different test files running in parallel.
// We derive the directory name from the importing file's name.
const callingFilePath = require.main ? require.main.filename : __filename;
const specificWorkspaceDirName = path.basename(callingFilePath, path.extname(callingFilePath));
const WORKSPACES_DIR = path.join(BASE_WORKSPACES_DIR, specificWorkspaceDirName);

function prepareWorkspace(name) {
  const workspace = path.join(WORKSPACES_DIR, name);
  // Ensure the specific workspace is clean before preparing
  if (fs.existsSync(workspace)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function cleanupWorkspaces() {
  if (fs.existsSync(WORKSPACES_DIR)) {
    fs.rmSync(WORKSPACES_DIR, { recursive: true, force: true });
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, data) {
  writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function createLogger() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

module.exports = {
  cleanupWorkspaces,
  createLogger,
  prepareWorkspace,
  writeFile,
  writeJson,
};
