const fs = require('fs');
const path = require('path');

const {
  findOverridesFile,
  run,
} = require('../scripts/generate-licenses-csv.cjs');
const {
  cleanupWorkspaces,
  createLogger,
  prepareWorkspace,
  writeFile,
  writeJson,
} = require('./helpers');

afterAll(() => {
  cleanupWorkspaces();
});

describe('generate-licenses-csv', () => {
  it('prefers the nearest override file in documented search order', () => {
    const workspace = prepareWorkspace('csv-overrides');
    writeFile(path.join(workspace, 'license-overrides.yml'), 'overrides: {}\n');
    writeFile(path.join(workspace, '.github/license-overrides.yml'), 'overrides: {}\n');
    writeFile(path.join(workspace, 'licenses/overrides.yml'), 'overrides: {}\n');

    expect(findOverridesFile(workspace)).toBe(path.join(workspace, 'license-overrides.yml'));
  });

  it('generates sorted CSV output, applies overrides, and escapes fields', () => {
    const workspace = prepareWorkspace('csv-output');
    const logger = createLogger();

    writeFile(
      path.join(workspace, '.github/license-overrides.yml'),
      [
        'overrides:',
        '  gamma@3.0.0:',
        '    license: Custom License',
        '    licenseUrl: https://override.example/license',
        '',
      ].join('\n')
    );

    const npmList = {
      dependencies: {
        beta: {
          version: '2.0.0',
          license: 'Apache-2.0',
          repository: { url: 'git+https://github.com/example/beta.git' },
        },
        alpha: {
          version: '1.0.0',
          license: 'MIT, "Special"',
          resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz',
        },
        gamma: {
          version: '3.0.0',
          license: 'UNKNOWN',
        },
      },
    };

    const result = run({
      cwd: workspace,
      execSyncImpl: jest.fn(() => JSON.stringify(npmList)),
      logger,
    });

    const csvContent = fs.readFileSync(path.join(workspace, 'licenses/licenses.csv'), 'utf8');
    const rows = csvContent.trim().split('\n');

    expect(rows[0]).toBe('name,version,license,licenseUrl,overrideUrl');
    expect(rows[1]).toBe('alpha,1.0.0,"MIT, ""Special""",https://www.npmjs.com/package/alpha/v/1.0.0,');
    expect(rows[2]).toBe('beta,2.0.0,Apache-2.0,https://github.com/example/beta,');
    expect(rows[3]).toBe('gamma,3.0.0,Custom License,https://override.example/license,https://override.example/license');
    expect(result.shouldFail).toBe(false);
    expect(result.unknownLicenses).toEqual([]);
  });

  it('filters out top-level dev dependencies in production-only mode while keeping nested runtime deps', () => {
    const workspace = prepareWorkspace('csv-production-only');
    const logger = createLogger();

    writeJson(path.join(workspace, 'package.json'), {
      name: 'fixture',
      version: '1.0.0',
      dependencies: {
        runtime: '^1.0.0',
      },
      devDependencies: {
        devtool: '^2.0.0',
      },
    });

    const npmList = {
      dependencies: {
        runtime: {
          version: '1.0.0',
          license: 'MIT',
          dependencies: {
            transitive: {
              version: '1.1.0',
              license: 'ISC',
            },
          },
        },
        devtool: {
          version: '2.0.0',
          license: 'Apache-2.0',
        },
      },
    };

    const result = run({
      cwd: workspace,
      env: { PRODUCTION_ONLY: 'true' },
      execSyncImpl: jest.fn(() => JSON.stringify(npmList)),
      logger,
    });

    expect(result.sortedPackages.map((pkg) => pkg.name)).toEqual(['runtime', 'transitive']);
  });

  it('reports unknown and copyleft licenses when fail flags are enabled', () => {
    const workspace = prepareWorkspace('csv-failures');
    const logger = createLogger();

    const npmList = {
      dependencies: {
        unknown: {
          version: '1.0.0',
        },
        copyleft: {
          version: '2.0.0',
          license: 'GPL-3.0',
        },
      },
    };

    const result = run({
      cwd: workspace,
      env: {
        FAIL_ON_UNKNOWN: 'true',
        FAIL_ON_COPYLEFT: 'true',
      },
      execSyncImpl: jest.fn(() => JSON.stringify(npmList)),
      logger,
    });

    expect(result.shouldFail).toBe(true);
    expect(result.unknownLicenses).toEqual([
      { name: 'unknown', version: '1.0.0', license: 'UNKNOWN' },
    ]);
    expect(result.copyleftLicenses).toEqual([
      { name: 'copyleft', version: '2.0.0', license: 'GPL-3.0' },
    ]);
  });
});
