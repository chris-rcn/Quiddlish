#!/usr/bin/env node
// Stamps index.html with the max mtime of all project source files.
// Run: node build.js

const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const IGNORE = new Set(['.git', 'node_modules']);

function walk(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(walk(full));
    else files.push(full);
  }
  return files;
}

const maxMtime = walk(ROOT)
  .filter(f => f !== path.join(ROOT, 'build.js'))
  .reduce((max, f) => {
    const t = fs.statSync(f).mtimeMs;
    return t > max ? t : max;
  }, 0);

const stamp = new Date(maxMtime).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const htmlPath = path.join(ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const updated = html.replace(
  /(<time id="build-stamp">)[^<]*(<\/time>)/,
  `$1${stamp}$2`
);
fs.writeFileSync(htmlPath, updated);
console.log('Stamped:', stamp);
