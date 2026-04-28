const fs = require('fs');
const path = require('path');

const {
  buildLicenseUrls,
  downloadLicense,
  run,
  sanitizeFilename,
} = require('../scripts/download-licenses.cjs');
const {
  cleanupWorkspaces,
  createLogger,
  prepareWorkspace,
  writeFile,
} = require('./helpers');

afterAll(() => {
  cleanupWorkspaces();
});

describe('download-licenses', () => {
  it('sanitizes filenames and appends override URLs after standard fallbacks', () => {
    expect(sanitizeFilename('@scope/package')).toBe('_scope_package');
    expect(buildLicenseUrls({
      name: '@scope/package',
      version: '1.2.3',
      overrideUrl: 'https://override.example/LICENSE',
    })).toEqual([
      'https://unpkg.com/@scope/package@1.2.3/LICENSE',
      'https://unpkg.com/@scope/package@1.2.3/LICENSE.md',
      'https://unpkg.com/@scope/package@1.2.3/LICENSE.txt',
      'https://unpkg.com/@scope/package@1.2.3/license',
      'https://unpkg.com/@scope/package@1.2.3/license.md',
      'https://unpkg.com/@scope/package@1.2.3/License.md',
      'https://override.example/LICENSE',
    ]);
  });

  it('reuses cached license files without downloading again', async () => {
    const workspace = prepareWorkspace('download-cache');
    const licensesDir = path.join(workspace, 'licenses/texts');
    fs.mkdirSync(licensesDir, { recursive: true });
    writeFile(path.join(licensesDir, 'left-pad-1.3.0.txt'), 'cached license');

    const downloadFileImpl = jest.fn();
    const [result] = await downloadLicense(
      { 'left-pad@1.3.0': 'left-pad-1.3.0.txt' },
      { name: 'left-pad', version: '1.3.0' },
      { licensesDir, downloadFileImpl }
    );

    expect(result).toEqual({
      success: true,
      filename: 'left-pad-1.3.0.txt',
      cached: true,
    });
    expect(downloadFileImpl).not.toHaveBeenCalled();
  });

  it('falls back to override URLs when package defaults do not contain a license file', async () => {
    const workspace = prepareWorkspace('download-override');
    const licensesDir = path.join(workspace, 'licenses/texts');
    fs.mkdirSync(licensesDir, { recursive: true });

    const downloadFileImpl = jest.fn((url, destination) => {
      if (url === 'https://override.example/LICENSE') {
        fs.writeFileSync(destination, 'override license', 'utf8');
        return Promise.resolve();
      }
      return Promise.reject(new Error('missing'));
    });

    const [result, cache] = await downloadLicense(
      {},
      {
        name: 'package',
        version: '1.0.0',
        overrideUrl: 'https://override.example/LICENSE',
      },
      { licensesDir, downloadFileImpl }
    );

    expect(result).toEqual({
      success: true,
      filename: 'package-1.0.0.txt',
      cached: false,
    });
    expect(cache).toEqual({ 'package@1.0.0': 'package-1.0.0.txt' });
    expect(fs.readFileSync(path.join(licensesDir, 'package-1.0.0.txt'), 'utf8')).toBe('override license');
  });

  it('allows missing licenses when fail-on-missing-licenses is false', async () => {
    const workspace = prepareWorkspace('download-soft-fail');
    const logger = createLogger();
    writeFile(
      path.join(workspace, 'licenses/licenses.csv'),
      'name,version,license,licenseUrl,overrideUrl\nmissing,1.0.0,MIT,,\n'
    );

    const result = await run({
      cwd: workspace,
      env: { FAIL_ON_MISSING_LICENSES: 'false' },
      downloadFileImpl: jest.fn(() => Promise.reject(new Error('not found'))),
      logger,
    });

    expect(result.shouldFail).toBe(false);
    expect(result.failures).toEqual([
      {
        success: false,
        package: 'missing@1.0.0',
        error: 'License file not found in package',
      },
    ]);
    expect(fs.existsSync(path.join(workspace, 'licenses/cache.json'))).toBe(true);
  });

  it('fails missing licenses by default', async () => {
    const workspace = prepareWorkspace('download-hard-fail');
    const logger = createLogger();
    writeFile(
      path.join(workspace, 'licenses/licenses.csv'),
      'name,version,license,licenseUrl,overrideUrl\nmissing,1.0.0,MIT,,\n'
    );

    const result = await run({
      cwd: workspace,
      downloadFileImpl: jest.fn(() => Promise.reject(new Error('not found'))),
      logger,
    });

    expect(result.shouldFail).toBe(true);
    expect(result.failures).toHaveLength(1);
  });
});
