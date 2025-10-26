const assertEnv = (name) => {
  if (!process.env[name]) {
    throw new Error(`Missing env: ${name}`);
  }
  return process.env[name];
};

let provider;
switch ((process.env.STORAGE_PROVIDER || 'bunny').toLowerCase()) {
  case 'bunny':
    provider = require('./bunny');
    break;
  default:
    throw new Error(`Unsupported STORAGE_PROVIDER: ${process.env.STORAGE_PROVIDER}`);
}

module.exports = {
  uploadVideoAndThumb: provider.uploadVideoAndThumb,
  purgeCdnPaths: provider.purgeCdnPaths,
  assertEnv,
};
