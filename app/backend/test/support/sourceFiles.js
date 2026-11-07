const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function walk(dir, ext, skip) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || skip.includes(e.name) ? [] : walk(full, ext, skip);
    return e.isFile() && ext.some((x) => e.name.endsWith(x)) ? [full] : [];
  });
}

function fileNames(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
}

function sourceFiles(dir, { ext = ['.js'], skip = [] } = {}) {
  const files = walk(dir, ext, skip);
  if (!files.length) return files;
  const check = spawnSync('git', ['check-ignore', '--', ...files], { cwd: dir, encoding: 'utf8' });
  if (check.status !== 0 && check.status !== 1) throw new Error(`git check-ignore failed: ${check.stderr}`);
  const ignored = new Set(check.stdout.split('\n').filter(Boolean).map((p) => path.resolve(dir, p)));
  return files.filter((file) => !ignored.has(path.resolve(file)));
}

module.exports = { fileNames, sourceFiles };
