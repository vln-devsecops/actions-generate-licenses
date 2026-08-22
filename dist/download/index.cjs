#!/usr/bin/env node
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 676:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { Transform } = __nccwpck_require__(203)

const [cr] = Buffer.from('\r')
const [nl] = Buffer.from('\n')
const defaults = {
  escape: '"',
  headers: null,
  mapHeaders: ({ header }) => header,
  mapValues: ({ value }) => value,
  newline: '\n',
  quote: '"',
  raw: false,
  separator: ',',
  skipComments: false,
  skipLines: null,
  maxRowBytes: Number.MAX_SAFE_INTEGER,
  strict: false,
  outputByteOffset: false
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function sanitizeHeader(header) {
  if (typeof header !== 'string') {
    return null
  }

  if (DANGEROUS_KEYS.has(header)) {
    return null
  }

  return header
}

class CsvParser extends Transform {
  constructor (opts = {}) {
    super({ objectMode: true, highWaterMark: 16 })

    if (Array.isArray(opts)) opts = { headers: opts }

    const options = Object.assign({}, defaults, opts)

    options.customNewline = options.newline !== defaults.newline

    for (const key of ['newline', 'quote', 'separator']) {
      if (typeof options[key] !== 'undefined') {
        ([options[key]] = Buffer.from(options[key]))
      }
    }

    // if escape is not defined on the passed options, use the end value of quote
    options.escape = (opts || {}).escape ? Buffer.from(options.escape)[0] : options.quote

    this.state = {
      empty: options.raw ? Buffer.alloc(0) : '',
      escaped: false,
      first: true,
      lineNumber: 0,
      previousEnd: 0,
      rowLength: 0,
      quoted: false
    }

    this._prev = null

    if (options.headers === false) {
      // enforce, as the column length check will fail if headers:false
      options.strict = false
    }

    if (options.headers || options.headers === false) {
      this.state.first = false
    }

    this.options = options
    this.headers = options.headers
    this.bytesRead = 0
  }

  parseCell (buffer, start, end) {
    const { escape, quote } = this.options
    // remove quotes from quoted cells
    if (buffer[start] === quote && buffer[end - 1] === quote) {
      start++
      end--
    }

    let y = start

    for (let i = start; i < end; i++) {
      // check for escape characters and skip them
      if (buffer[i] === escape && i + 1 < end && buffer[i + 1] === quote) {
        i++
      }

      if (y !== i) {
        buffer[y] = buffer[i]
      }
      y++
    }

    return this.parseValue(buffer, start, y)
  }

  parseLine (buffer, start, end) {
    const { customNewline, escape, mapHeaders, mapValues, quote, separator, skipComments, skipLines } = this.options

    end-- // trim newline
    if (!customNewline && buffer.length && buffer[end - 1] === cr) {
      end--
    }

    const comma = separator
    const cells = []
    let isQuoted = false
    let offset = start

    if (skipComments) {
      const char = typeof skipComments === 'string' ? skipComments : '#'
      if (buffer[start] === Buffer.from(char)[0]) {
        return
      }
    }

    const mapValue = (value) => {
      if (this.state.first) {
        return value
      }

      const index = cells.length
      const header = this.headers[index]

      return mapValues({ header, index, value })
    }

    for (let i = start; i < end; i++) {
      const isStartingQuote = !isQuoted && buffer[i] === quote
      const isEndingQuote = isQuoted && buffer[i] === quote && i + 1 <= end && buffer[i + 1] === comma
      const isEscape = isQuoted && buffer[i] === escape && i + 1 < end && buffer[i + 1] === quote

      if (isStartingQuote || isEndingQuote) {
        isQuoted = !isQuoted
        continue
      } else if (isEscape) {
        i++
        continue
      }

      if (buffer[i] === comma && !isQuoted) {
        let value = this.parseCell(buffer, offset, i)
        value = mapValue(value)
        cells.push(value)
        offset = i + 1
      }
    }

    if (offset < end) {
      let value = this.parseCell(buffer, offset, end)
      value = mapValue(value)
      cells.push(value)
    }

    if (buffer[end - 1] === comma) {
      cells.push(mapValue(this.state.empty))
    }

    const skip = skipLines && skipLines > this.state.lineNumber
    this.state.lineNumber++

    if (this.state.first && !skip) {
      this.state.first = false
      this.headers = cells.map((header, index) => {
        const mapped = mapHeaders({ header, index })

        if (mapped === null) {
          return null
        }

        return sanitizeHeader(mapped)
      })

      this.emit('headers', this.headers)
      return
    }

    if (!skip && this.options.strict && cells.length !== this.headers.length) {
      const e = new RangeError('Row length does not match headers')
      this.emit('error', e)
    } else {
      if (!skip) {
        const byteOffset = this.bytesRead - buffer.length + start
        this.writeRow(cells, byteOffset)
      }
    }
  }

  parseValue (buffer, start, end) {
    if (this.options.raw) {
      return buffer.slice(start, end)
    }

    return buffer.toString('utf-8', start, end)
  }

  writeRow (cells, byteOffset) {
    const headers = (this.headers === false) ? cells.map((value, index) => index) : this.headers

    const row = cells.reduce((o, cell, index) => {
      const header = headers[index]
      if (header === null) return o // skip columns
      if (header !== undefined) {
        o[header] = cell
      } else {
        o[`_${index}`] = cell
      }
      return o
    }, {})

    if (this.options.outputByteOffset) {
      this.push({ row, byteOffset })
    } else {
      this.push(row)
    }
  }

  _flush (cb) {
    if (this.state.escaped || !this._prev) return cb()
    this.parseLine(this._prev, this.state.previousEnd, this._prev.length + 1) // plus since online -1s
    cb()
  }

  _transform (data, enc, cb) {
    if (typeof data === 'string') {
      data = Buffer.from(data)
    }

    const { escape, quote } = this.options
    let start = 0
    let buffer = data
    this.bytesRead += data.byteLength

    if (this._prev) {
      start = this._prev.length
      buffer = Buffer.concat([this._prev, data])
      this._prev = null
    }

    const bufferLength = buffer.length

    for (let i = start; i < bufferLength; i++) {
      const chr = buffer[i]
      const nextChr = i + 1 < bufferLength ? buffer[i + 1] : null

      this.state.rowLength++
      if (this.state.rowLength > this.options.maxRowBytes) {
        return cb(new Error('Row exceeds the maximum size'))
      }

      if (!this.state.escaped && chr === escape && nextChr === quote && i !== start) {
        this.state.escaped = true
        continue
      } else if (chr === quote) {
        if (this.state.escaped) {
          this.state.escaped = false
          // non-escaped quote (quoting the cell)
        } else {
          this.state.quoted = !this.state.quoted
        }
        continue
      }

      if (!this.state.quoted) {
        if (this.state.first && !this.options.customNewline) {
          if (chr === nl) {
            this.options.newline = nl
          } else if (chr === cr) {
            if (nextChr !== nl) {
              this.options.newline = cr
            }
          }
        }

        if (chr === this.options.newline) {
          this.parseLine(buffer, this.state.previousEnd, i + 1)
          this.state.previousEnd = i + 1
          this.state.rowLength = 0
        }
      }
    }

    if (this.state.previousEnd === bufferLength) {
      this.state.previousEnd = 0
      return cb()
    }

    if (bufferLength - this.state.previousEnd < data.length) {
      this._prev = data
      this.state.previousEnd -= (bufferLength - data.length)
      return cb()
    }

    this._prev = buffer
    cb()
  }
}

module.exports = (opts) => new CsvParser(opts)


/***/ }),

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 692:
/***/ ((module) => {

"use strict";
module.exports = require("https");

/***/ }),

/***/ 928:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ }),

/***/ 203:
/***/ ((module) => {

"use strict";
module.exports = require("stream");

/***/ }),

/***/ 987:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

/* module decorator */ module = __nccwpck_require__.nmd(module);

/**
 * Download license files for all npm dependencies
 * Reads from licenses.csv to only download licenses for packages that will be included in the final report
 */

const fs = __nccwpck_require__(896);
const csv = __nccwpck_require__(676);
const path = __nccwpck_require__(928);
const https = __nccwpck_require__(692);

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

if (__nccwpck_require__.c[__nccwpck_require__.s] === module) {
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


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			id: moduleId,
/******/ 			loaded: false,
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the module cache
/******/ 	__nccwpck_require__.c = __webpack_module_cache__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/asset-relocator-loader */
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/******/ 	/* webpack/runtime/node module decorator */
/******/ 	(() => {
/******/ 		__nccwpck_require__.nmd = (module) => {
/******/ 			module.paths = [];
/******/ 			if (!module.children) module.children = [];
/******/ 			return module;
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// module cache are used so entry inlining is disabled
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	var __webpack_exports__ = __nccwpck_require__(__nccwpck_require__.s = 987);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;