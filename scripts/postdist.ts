const fs = require('fs');
const path = require('path');
const {
  name: packageName,
  version,
  description,
  keywords,
  repository,
  main,
  browser,
  engines,
  author,
  license,
  dependencies,
} = require('../package.json');

const distPkgJSON = {
  name: packageName,
  version,
  description,
  keywords,
  repository,
  main,
  browser,
  engines,
  author,
  license,
  dependencies,
};

fs.writeFileSync(
  path.resolve(__dirname, '../dist/package.json'),
  JSON.stringify(distPkgJSON, null, 2),
);

fs.copyFileSync(
  path.resolve(__dirname, '../README.md'),
  path.resolve(__dirname, '../dist/README.md'),
);
