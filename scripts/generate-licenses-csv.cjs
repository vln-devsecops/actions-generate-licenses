#!/usr/bin/env node

/**
 * Generate a CSV file of all npm dependencies with their licenses
 * Output format: name,version,license,licenseUrl,overrideUrl
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

function getPaths(cwd = process.cwd()) {
  const outputCsv = path.join(cwd, 'licenses/licenses.csv');
  return {
    cwd,
    outputCsv,
    outputDir: path.dirname(outputCsv),
  };
}

function findOverridesFile(cwd = process.cwd(), fsImpl = fs) {
  const possiblePaths = [
    path.join(cwd, 'license-overrides.yml'),
    path.join(cwd, '.github/license-overrides.yml'),
    path.join(cwd, 'licenses/overrides.yml'),
  ];

  for (const filePath of possiblePaths) {
    if (fsImpl.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function loadOverrides(cwd = process.cwd(), options = {}) {
  const {
    fsImpl = fs,
    yamlImpl = yaml,
    logger = console,
  } = options;
  const overridesFile = findOverridesFile(cwd, fsImpl);
  let overrides = {};

  if (overridesFile && fsImpl.existsSync(overridesFile)) {
    try {
      const overridesContent = fsImpl.readFileSync(overridesFile, 'utf8');
      const overridesData = yamlImpl.load(overridesContent);
      if (overridesData && overridesData.overrides) {
        overrides = overridesData.overrides;
        logger.log(`Loaded ${Object.keys(overrides).length} license override(s) from ${overridesFile}`);
      }
    } catch (err) {
      logger.warn(`Warning: Failed to load license overrides: ${err.message}`);
    }
  } else {
    logger.log('No license overrides file found. Checked locations:');
    logger.log('  - license-overrides.yml (working directory)');
    logger.log('  - .github/license-overrides.yml (working directory)');
    logger.log('  - licenses/overrides.yml (working directory)');
  }

  return { overrides, overridesFile };
}

function ensureOutputDir(outputDir, fsImpl = fs) {
  if (!fsImpl.existsSync(outputDir)) {
    fsImpl.mkdirSync(outputDir, { recursive: true });
  }
}

function getProductionDependencies(cwd = process.cwd(), options = {}) {
  const {
    fsImpl = fs,
    logger = console,
  } = options;
  const productionDeps = new Set();

  try {
    const packageJsonPath = path.join(cwd, 'package.json');
    const packageJson = JSON.parse(fsImpl.readFileSync(packageJsonPath, 'utf8'));
    for (const dep of Object.keys(packageJson.dependencies || {})) {
      productionDeps.add(dep);
    }
    logger.log(`Production-only mode: filtering to ${productionDeps.size} direct production dependencies`);
  } catch (err) {
    logger.warn('Warning: Could not read package.json for production-only mode, falling back to full scan');
  }

  return productionDeps;
}

function getLicenseUrl(name, version, info) {
  if (info.resolved) {
    return `https://www.npmjs.com/package/${name}/v/${version}`;
  }

  if (info.repository) {
    if (typeof info.repository === 'string') {
      return info.repository;
    }

    if (info.repository.url) {
      return info.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
    }
  }

  return '';
}

function extractPackages(deps, options = {}) {
  const {
    packages = new Map(),
    overrides = {},
    allowedTopLevel = null,
  } = options;

  if (!deps) {
    return packages;
  }

  for (const [name, info] of Object.entries(deps)) {
    if (allowedTopLevel && !allowedTopLevel.has(name)) {
      continue;
    }

    const version = info.version;
    const key = `${name}@${version}`;

    if (!packages.has(key)) {
      let license = info.license || 'UNKNOWN';
      let licenseUrl = '';
      let overrideUrl = '';

      if (overrides[key]) {
        const override = overrides[key];
        if (override.license) {
          license = override.license;
        }
        if (override.licenseUrl) {
          licenseUrl = override.licenseUrl;
          overrideUrl = override.licenseUrl;
        }
      }

      if (!licenseUrl) {
        licenseUrl = getLicenseUrl(name, version, info);
      }

      packages.set(key, {
        name,
        version,
        license,
        licenseUrl,
        overrideUrl,
      });
    }

    if (info.dependencies) {
      extractPackages(info.dependencies, {
        packages,
        overrides,
        allowedTopLevel: null,
      });
    }
  }

  return packages;
}

function escapeCsv(str) {
  if (!str) {
    return '';
  }

  const strValue = String(str);
  if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
    return `"${strValue.replace(/"/g, '""')}"`;
  }

  return strValue;
}

function generateCsvContent(sortedPackages) {
  const csvLines = ['name,version,license,licenseUrl,overrideUrl'];

  for (const pkg of sortedPackages) {
    csvLines.push(
      `${escapeCsv(pkg.name)},${escapeCsv(pkg.version)},${escapeCsv(pkg.license)},${escapeCsv(pkg.licenseUrl)},${escapeCsv(pkg.overrideUrl)}`
    );
  }

  return csvLines.join('\n');
}

function analyzePackages(sortedPackages) {
  const licenseCounts = new Map();
  const copyleftLicenses = [];
  const unknownLicenses = [];

  for (const pkg of sortedPackages) {
    const license = pkg.license;
    licenseCounts.set(license, (licenseCounts.get(license) || 0) + 1);

    if (license === 'UNKNOWN' || license === '' || !license) {
      unknownLicenses.push({ name: pkg.name, version: pkg.version, license: license || 'UNKNOWN' });
    }

    const copyleftPatterns = /GPL|AGPL|LGPL|MPL|EPL|CDDL|CPL/i;
    if (copyleftPatterns.test(license)) {
      copyleftLicenses.push({ name: pkg.name, version: pkg.version, license });
    }
  }

  return {
    licenseCounts: Array.from(licenseCounts.entries()).sort((a, b) => b[1] - a[1]),
    copyleftLicenses,
    unknownLicenses,
  };
}

function run(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const execSyncImpl = options.execSyncImpl || execSync;
  const fsImpl = options.fsImpl || fs;
  const logger = options.logger || console;
  const yamlImpl = options.yamlImpl || yaml;
  const { outputCsv, outputDir } = getPaths(cwd);

  ensureOutputDir(outputDir, fsImpl);
  const { overrides, overridesFile } = loadOverrides(cwd, { fsImpl, yamlImpl, logger });

  logger.log('Generating licenses CSV...');
  logger.log(`DEBUG: PRODUCTION_ONLY environment variable = "${env.PRODUCTION_ONLY}"`);

  let productionDeps = new Set();
  if (env.PRODUCTION_ONLY === 'true') {
    productionDeps = getProductionDependencies(cwd, { fsImpl, logger });
  }

  let npmList;
  try {
    npmList = execSyncImpl('npm list --json --all --long --omit=peer', {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    if (err.stdout) {
      npmList = err.stdout;
    } else {
      throw err;
    }
  }

  const dependencies = JSON.parse(npmList);
  const packages = new Map();

  if (dependencies.dependencies) {
    if (env.PRODUCTION_ONLY === 'true' && productionDeps.size > 0) {
      logger.log('Production-only mode: filtering dependency tree...');
      extractPackages(dependencies.dependencies, {
        packages,
        overrides,
        allowedTopLevel: productionDeps,
      });
    } else {
      extractPackages(dependencies.dependencies, { packages, overrides });
    }
  }

  const sortedPackages = Array.from(packages.values()).sort((a, b) => a.name.localeCompare(b.name));
  const csvContent = generateCsvContent(sortedPackages);
  fsImpl.writeFileSync(outputCsv, csvContent, 'utf8');

  logger.log(`✓ Generated licenses CSV with ${sortedPackages.length} packages`);
  logger.log(`  Output: ${outputCsv}`);

  const { licenseCounts, copyleftLicenses, unknownLicenses } = analyzePackages(sortedPackages);

  logger.log('\n📊 License Summary:');
  logger.log('===================');
  for (const [license, count] of licenseCounts) {
    logger.log(`  ${license}: ${count}`);
  }

  let shouldFail = false;

  if (unknownLicenses.length > 0) {
    logger.log('\n⚠️  UNKNOWN LICENSES DETECTED:');
    logger.log('===============================');
    for (const pkg of unknownLicenses) {
      logger.log(`  - ${pkg.name}@${pkg.version}: ${pkg.license}`);
    }
    logger.log('\nPlease add license information for these packages to license overrides.');

    if (env.FAIL_ON_UNKNOWN === 'true') {
      logger.error('\n❌ Build will fail due to unknown licenses detected.');
      shouldFail = true;
    }
  } else {
    logger.log('\n✓ No unknown licenses detected.');
  }

  if (copyleftLicenses.length > 0) {
    logger.log('\n⚠️  COPYLEFT LICENSES DETECTED:');
    logger.log('================================');
    for (const pkg of copyleftLicenses) {
      logger.log(`  - ${pkg.name}@${pkg.version}: ${pkg.license}`);
    }
    logger.log('\nPlease review these licenses carefully to ensure compliance.');

    if (env.FAIL_ON_COPYLEFT === 'true') {
      logger.error('\n❌ Build will fail due to copyleft licenses detected.');
      shouldFail = true;
    }
  } else {
    logger.log('\n✓ No copyleft licenses detected.');
  }

  if (shouldFail) {
    logger.error('\n❌ Build failed due to license policy violations.');
    logger.error('   Either remove these dependencies or add them to license overrides.');
  }

  return {
    sortedPackages,
    outputCsv,
    overridesFile,
    licenseCounts,
    unknownLicenses,
    copyleftLicenses,
    shouldFail,
  };
}

function main() {
  try {
    const result = run();
    if (result.shouldFail) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzePackages,
  escapeCsv,
  extractPackages,
  findOverridesFile,
  generateCsvContent,
  getLicenseUrl,
  getPaths,
  loadOverrides,
  main,
  run,
};
