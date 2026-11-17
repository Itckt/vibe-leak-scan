import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { extractImports } from '../src/imports.js';

// Synthetic single-line minified source; no network or credentials.
const unit = 'const x=0;import{a as b}from"./chunk.js";import("./lazy.js");';
const source = unit.repeat(Math.ceil(5_000_000 / unit.length)).slice(0, 5_000_000);
assert.equal(Buffer.byteLength(source), 5_000_000);
const start = performance.now();
const result = extractImports(source, 'https://fixture.invalid/app.js');
const duration = performance.now() - start;
assert.equal(result.urls.length, 2);
console.log(`匯入擷取：5,000,000 位元組、單行，${duration.toFixed(2)} 毫秒；2 個去重網址，1 通過、0 失敗。`);

// Repeated incomplete declarations and an unterminated literal stress linear scanning.
const hostile = 'from '.repeat(999_999) + '"from';
const hostileStart = performance.now();
assert.equal(extractImports(hostile, 'https://fixture.invalid/app.js').unresolved, true);
console.log(`未完成宣告與字串：${Buffer.byteLength(hostile).toLocaleString('en-US')} 位元組，${(performance.now() - hostileStart).toFixed(2)} 毫秒；1 通過、0 失敗。`);
