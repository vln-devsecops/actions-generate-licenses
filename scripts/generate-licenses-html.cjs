#!/usr/bin/env node

/**
 * Generate HTML page from licenses CSV and downloaded license files
 * Uses Nunjucks template to create a styled page matching the app's CSS
 */

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

function getPaths(options = {}) {
  const cwd = options.cwd || process.cwd();
  const scriptDir = options.scriptDir || __dirname;
  const packageDir = path.dirname(scriptDir);

  return {
    cwd,
    scriptDir,
    packageDir,
    csvFile: path.join(cwd, 'licenses', 'licenses.csv'),
    licensesDir: path.join(cwd, 'licenses', 'texts'),
    outputFile: path.join(cwd, 'public', 'licenses.html'),
    localTemplate: path.join(cwd, 'licenses.html.j2'),
    packageTemplate: path.join(packageDir, 'templates', 'licenses.html.j2'),
    legacyTemplate: path.join(scriptDir, 'licenses.html.j2'),
  };
}

function findTemplate(paths = getPaths(), options = {}) {
  const {
    fsImpl = fs,
    logger = console,
  } = options;

  if (fsImpl.existsSync(paths.localTemplate)) {
    logger.log(`Using local template: ${paths.localTemplate}`);
    return paths.localTemplate;
  }

  if (fsImpl.existsSync(paths.packageTemplate)) {
    logger.log(`Using package template: ${paths.packageTemplate}`);
    return paths.packageTemplate;
  }

  if (fsImpl.existsSync(paths.legacyTemplate)) {
    logger.log(`Using legacy template: ${paths.legacyTemplate}`);
    return paths.legacyTemplate;
  }

  throw new Error(
    `No template found. Searched:\n` +
    `  1. Local: ${paths.localTemplate}\n` +
    `  2. Package: ${paths.packageTemplate}\n` +
    `  3. Legacy: ${paths.legacyTemplate}\n` +
    `\nTo customize the template, copy the default template to your project root:\n` +
    `  cp ${paths.packageTemplate} ${paths.localTemplate}`
  );
}

function sanitizeFilename(name, version) {
  function sanitize(value) {
    return value.replace(/[^a-zA-Z0-9.-]/g, '_');
  }

  return `${sanitize(name)}-${sanitize(version)}.txt`;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function loadLicenses(paths = getPaths(), options = {}) {
  const {
    fsImpl = fs,
    logger = console,
  } = options;
  const licenses = [];

  if (!fsImpl.existsSync(paths.csvFile)) {
    throw new Error(`CSV file not found: ${paths.csvFile}`);
  }

  const csvContent = fsImpl.readFileSync(paths.csvFile, 'utf-8');
  const lines = csvContent.split('\n');

  if (lines.length < 2) {
    throw new Error('CSV file appears to be empty or malformed');
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.replace(/^"|"$/g, '').trim());

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    const name = row.name;
    const version = row.version;
    const licenseId = row.license;
    let licenseUrl = row.licenseUrl;
    const overrideUrl = row.overrideUrl;

    if (!name) {
      continue;
    }

    if (overrideUrl) {
      licenseUrl = overrideUrl;
    }

    const licenseFilename = sanitizeFilename(name, version);
    const licensePath = path.join(paths.licensesDir, licenseFilename);

    let licenseText = null;
    if (fsImpl.existsSync(licensePath)) {
      try {
        licenseText = fsImpl.readFileSync(licensePath, 'utf-8');
      } catch (error) {
        logger.warn(`Warning: Could not read license file ${licensePath}: ${error.message}`);
      }
    }

    licenses.push({
      name,
      version,
      license: licenseId,
      license_url: licenseUrl,
      license_text: licenseText,
    });
  }

  return licenses;
}

function generateHtml(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const nunjucksImpl = options.nunjucksImpl || nunjucks;
  const logger = options.logger || console;
  const paths = getPaths(options);

  logger.log('Generating licenses HTML page...');
  const licenses = loadLicenses(paths, { fsImpl, logger });

  const licenseCounts = {};
  for (const license of licenses) {
    licenseCounts[license.license] = (licenseCounts[license.license] || 0) + 1;
  }

  const sortedLicenseCounts = Object.entries(licenseCounts).sort((a, b) => b[1] - a[1]);
  const templateFile = findTemplate(paths, { fsImpl, logger });
  const templateDir = path.dirname(templateFile);
  const templateName = path.basename(templateFile);

  nunjucksImpl.configure(templateDir, {
    autoescape: true,
    trimBlocks: true,
    lstripBlocks: true,
  });

  const html = nunjucksImpl.render(templateName, {
    licenses,
    license_counts: sortedLicenseCounts,
    total_count: licenses.length,
  });

  const outputDir = path.dirname(paths.outputFile);
  if (!fsImpl.existsSync(outputDir)) {
    fsImpl.mkdirSync(outputDir, { recursive: true });
  }

  fsImpl.writeFileSync(paths.outputFile, html, 'utf-8');

  logger.log(`✓ Generated licenses page: ${paths.outputFile}`);
  logger.log(`  Total packages: ${licenses.length}`);
  logger.log(`  Unique licenses: ${Object.keys(licenseCounts).length}`);

  return {
    licenses,
    licenseCounts: sortedLicenseCounts,
    outputFile: paths.outputFile,
  };
}

if (require.main === module) {
  try {
    generateHtml();
  } catch (error) {
    console.error('Error:', error.message || error);
    process.exit(1);
  }
}

module.exports = {
  findTemplate,
  generateHtml,
  getPaths,
  loadLicenses,
  sanitizeFilename,
};
