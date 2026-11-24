const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = function prepareBlueScores() {
  execFileSync(
    process.platform === 'win32' ? 'python' : 'python3',
    [path.join(__dirname, 'prepare-blue-scores.py')],
    { stdio: 'inherit' }
  );
};
