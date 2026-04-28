const fs = require('fs');
const path = require('path');

const WORKSPACES_DIR = path.join(__dirname, '.workspaces');

function prepareWorkspace(name) {
  const workspace = path.join(WORKSPACES_DIR, name);
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function cleanupWorkspaces() {
  fs.rmSync(WORKSPACES_DIR, { recursive: true, force: true });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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
