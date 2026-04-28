const fs = require('fs');
const path = require('path');

const {
  findTemplate,
  generateHtml,
  getPaths,
  loadLicenses,
} = require('../scripts/generate-licenses-html.cjs');
const {
  cleanupWorkspaces,
  createLogger,
  prepareWorkspace,
  writeFile,
} = require('./helpers');

const scriptDir = path.join(__dirname, '../scripts');

afterAll(() => {
  cleanupWorkspaces();
});

describe('generate-licenses-html', () => {
  it('prefers local templates before package and legacy fallbacks', () => {
    const workspace = prepareWorkspace('html-template-order');
    const mockScriptDir = path.join(workspace, 'mock-package/scripts');
    const paths = getPaths({ cwd: workspace, scriptDir: mockScriptDir });

    writeFile(paths.localTemplate, 'local');
    writeFile(paths.packageTemplate, 'package');
    writeFile(paths.legacyTemplate, 'legacy');

    expect(findTemplate(paths, { logger: createLogger() })).toBe(paths.localTemplate);
  });

  it('loads license rows, prefers override URLs, and attaches license text when present', () => {
    const workspace = prepareWorkspace('html-load');
    const paths = getPaths({ cwd: workspace, scriptDir });

    writeFile(
      paths.csvFile,
      'name,version,license,licenseUrl,overrideUrl\npackage,1.0.0,MIT,https://npmjs.example,https://override.example\n'
    );
    writeFile(path.join(paths.licensesDir, 'package-1.0.0.txt'), 'License body');

    const licenses = loadLicenses(paths, { logger: createLogger() });

    expect(licenses).toEqual([
      {
        name: 'package',
        version: '1.0.0',
        license: 'MIT',
        license_url: 'https://override.example',
        license_text: 'License body',
      },
    ]);
  });

  it('renders HTML output from the selected template', () => {
    const workspace = prepareWorkspace('html-render');
    const paths = getPaths({ cwd: workspace, scriptDir });

    writeFile(
      paths.csvFile,
      'name,version,license,licenseUrl,overrideUrl\npackage,1.0.0,MIT,https://npmjs.example,\n'
    );
    writeFile(path.join(paths.licensesDir, 'package-1.0.0.txt'), 'License body');
    writeFile(paths.localTemplate, 'count={{ total_count }} name={{ licenses[0].name }} license={{ license_counts[0][0] }}');

    const result = generateHtml({ cwd: workspace, scriptDir, logger: createLogger() });
    const html = fs.readFileSync(result.outputFile, 'utf8');

    expect(html).toContain('count=1');
    expect(html).toContain('name=package');
    expect(html).toContain('license=MIT');
  });
});
