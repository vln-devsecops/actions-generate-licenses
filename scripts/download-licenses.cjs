#!/usr/bin/env node

/**
 * Download license files for all npm dependencies
 * Reads from licenses.csv to only download licenses for packages that will be included in the final report
 */

const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const https = require('https');

function getPaths(cwd = process.cwd()) {
  return {
    cwd,
    licensesDir: path.join(cwd, 'licenses/texts'),
    licensesCsv: path.join(cwd, 'licenses/licenses.csv'),
    cacheFile: path.join(cwd, 'licenses/cache.json'),
  };
}

function ensureLicenseDirExists(licensesDir, options = {}) {
  const {
    fsImpl = fs,
    logger = console,
  } = options;

  if (!fsImpl.existsSync(licensesDir)) {
    logger.warn(`${licensesDir} does not exist -- creating it`);
    fsImpl.mkdirSync(licensesDir, { recursive: true });
  }
}

function ensureCsvFileExists(licensesCsv, options = {}) {
  const { fsImpl = fs } = options;

  if (!fsImpl.existsSync(licensesCsv)) {
    throw new Error('licenses.csv not found. Please run generate-licenses-csv first.');
  }
}

function loadCache(cacheFile, options = {}) {
  const {
    fsImpl = fs,
    logger = console,
  } = options;

  if (!fsImpl.existsSync(cacheFile)) {
    return {};
  }

  logger.log(`Loading ${cacheFile}`);
  return JSON.parse(fsImpl.readFileSync(cacheFile, 'utf8'));
}

function downloadFile(url, dest, options = {}) {
  const {
    httpsImpl = https,
    fsImpl = fs,
  } = options;

  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} to ${dest}`);
    httpsImpl.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    }, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        return downloadFile(response.headers.location, dest, options)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const file = fsImpl.createWriteStream(dest);
      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        fsImpl.unlink(dest, () => {});
        reject(err);
      });
    }).on('error', reject).on('timeout', () => {
      reject(new Error('Request timeout'));
    });
  });
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9.-]/gi, '_');
}

function buildLicenseUrls(pkg) {
  const urls = [
    `https://unpkg.com/${pkg.name}@${pkg.version}/LICENSE`,
    `https://unpkg.com/${pkg.name}@${pkg.version}/LICENSE.md`,
    `https://unpkg.com/${pkg.name}@${pkg.version}/LICENSE.txt`,
    `https://unpkg.com/${pkg.name}@${pkg.version}/license`,
    `https://unpkg.com/${pkg.name}@${pkg.version}/license.md`,
    `https://unpkg.com/${pkg.name}@${pkg.version}/License.md`,
  ];

  if (pkg.overrideUrl) {
    urls.push(pkg.overrideUrl);
  }

  return urls;
}

async function downloadLicense(cache, pkg, options = {}) {
  const licensesDir = options.licensesDir || getPaths(options.cwd).licensesDir;
  const fsImpl = options.fsImpl || fs;
  const downloadFileImpl = options.downloadFileImpl || downloadFile;
  const cacheKey = `${pkg.name}@${pkg.version}`;

  if (cache[cacheKey] && fsImpl.existsSync(path.join(licensesDir, cache[cacheKey]))) {
    return [{ success: true, filename: cache[cacheKey], cached: true }, cache];
  }

  const filename = `${sanitizeFilename(pkg.name)}-${sanitizeFilename(pkg.version)}.txt`;
  const filepath = path.join(licensesDir, filename);

  for (const url of buildLicenseUrls(pkg)) {
    try {
      await downloadFileImpl(url, filepath, options);
      cache[cacheKey] = filename;
      return [{ success: true, filename, cached: false }, cache];
    } catch (err) {
      // Try next URL.
    }
  }

  return [{
    success: false,
    package: `${pkg.name}@${pkg.version}`,
    error: 'License file not found in package',
  }, cache];
}

async function processPackages(cache, packagesArray, options = {}) {
  const {
    cacheFile = getPaths(options.cwd).cacheFile,
    fsImpl = fs,
    logger = console,
    failOnMissingLicenses = true,
  } = options;

  let downloaded = 0;
  let cached = 0;
  const failures = [];

  for (let i = 0; i < packagesArray.length; i++) {
    const pkg = packagesArray[i];

    try {
      let result;
      [result, cache] = await downloadLicense(cache, pkg, options);

      if (result.success) {
        if (result.cached) {
          cached++;
        } else {
          downloaded++;
        }
      } else {
        failures.push(result);
      }

      if ((i + 1) % 50 === 0) {
        logger.log(`  Progress: ${i + 1}/${packagesArray.length} packages...`);
      }
    } catch (err) {
      failures.push({
        success: false,
        package: `${pkg.name}@${pkg.version}`,
        error: err.message,
      });
    }
  }

  fsImpl.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');

  logger.log(`\n✓ Processed ${packagesArray.length} packages`);
  logger.log(`  Downloaded: ${downloaded}`);
  logger.log(`  Cached: ${cached}`);

  if (failures.length > 0) {
    logger.log(`\n❌ Failed to download licenses for ${failures.length} packages:`);
    failures.forEach((failure) => {
      logger.log(`  - ${failure.package}: ${failure.error}`);
    });

    if (failOnMissingLicenses) {
      logger.log('\n💡 To fix these failures:');
      logger.log('   1. Add manual overrides to license-overrides.yml');
      logger.log('   2. Or contact package maintainers to include license files');
      logger.log('   3. Set fail-on-missing-licenses: false to allow missing licenses');
    }
  }

  return {
    cache,
    downloaded,
    cached,
    failures,
    shouldFail: failures.length > 0 && failOnMissingLicenses,
  };
}

function parseCsv(licensesCsv, options = {}) {
  const {
    fsImpl = fs,
    csvParserFactory = csv,
  } = options;

  return new Promise((resolve, reject) => {
    const lines = [];
    const stream = fsImpl.createReadStream(licensesCsv, 'utf-8');
    stream.on('error', reject);
    stream
      .pipe(csvParserFactory())
      .on('data', (data) => lines.push(data))
      .on('end', () => resolve(lines))
      .on('error', reject);
  });
}

async function run(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const logger = options.logger || console;
  const paths = getPaths(cwd);

  ensureLicenseDirExists(paths.licensesDir, { fsImpl, logger });
  ensureCsvFileExists(paths.licensesCsv, { fsImpl });
  const cache = loadCache(paths.cacheFile, { fsImpl, logger });
  const lines = await parseCsv(paths.licensesCsv, options);

  return processPackages(cache, lines, {
    ...options,
    ...paths,
    fsImpl,
    logger,
    failOnMissingLicenses: env.FAIL_ON_MISSING_LICENSES !== 'false',
  });
}

async function main() {
  try {
    const result = await run();
    process.exit(result.shouldFail ? 1 : 0);
  } catch (error) {
    console.error('Error:', error.message || error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildLicenseUrls,
  downloadFile,
  downloadLicense,
  ensureCsvFileExists,
  ensureLicenseDirExists,
  getPaths,
  loadCache,
  main,
  parseCsv,
  processPackages,
  run,
  sanitizeFilename,
};
