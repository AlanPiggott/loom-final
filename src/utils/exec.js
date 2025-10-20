const { spawn } = require('child_process');

function execFile(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = ''; let err = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('close', code => {
      if (code === 0) return resolve({ stdout: out, stderr: err, code });
      const e = new Error(`${bin} exited with code ${code}\n${err}`);
      e.stdout = out; e.stderr = err; e.code = code;
      reject(e);
    });
  });
}

module.exports = { execFile };
