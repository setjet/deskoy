const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('settings use local font fallbacks without fetching Google Fonts', () => {
  assert.doesNotMatch(read('index.html'), /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(read('src/styles/main-window.css'), /--font: 'Inter', 'Segoe UI Variable Text', 'Segoe UI'/);
});

test('the X credit uses the bundled Deskoy logo instead of a remote image', () => {
  const ui = read('src/legacy-ui/index.ts');
  assert.match(ui, /import brandLogoUrl from '\.\.\/\.\.\/assets\/logo\.png'/);
  assert.match(ui, /<img src="\$\{brandLogoUrl\}"/);
  assert.doesNotMatch(ui, /pbs\.twimg\.com/);
});
