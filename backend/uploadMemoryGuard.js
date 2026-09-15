'use strict';

/**
 * Multer's memoryStorage keeps an entire upload in RAM. The legacy upload
 * routes still consume file.buffer, so switching storage engines in one jump
 * would break APK parsing/hash/icon extraction. Until those routes are split
 * into streaming modules, serialize memory-backed file ingestion globally.
 *
 * A queued file stream remains back-pressured by Node/Busboy instead of letting
 * several 50-150 MiB buffers coexist. This removes the parallel-upload OOM
 * multiplier while preserving the route contract byte-for-byte.
 */
function installUploadMemoryGuard() {
  const multer = require('multer');
  if (multer.__mdmMemoryGuardInstalled) return;

  const originalMemoryStorage = multer.memoryStorage.bind(multer);
  const waiters = [];
  let active = false;

  function acquire(run) {
    if (!active) {
      active = true;
      run();
      return;
    }
    waiters.push(run);
  }

  function release() {
    const next = waiters.shift();
    if (next) {
      next();
    } else {
      active = false;
    }
  }

  multer.memoryStorage = function guardedMemoryStorage() {
    const delegate = originalMemoryStorage();
    return {
      _handleFile(req, file, cb) {
        acquire(() => {
          let completed = false;
          const finish = (err, info) => {
            if (completed) return;
            completed = true;
            release();
            cb(err, info);
          };
          try {
            delegate._handleFile(req, file, finish);
          } catch (error) {
            finish(error);
          }
        });
      },
      _removeFile(req, file, cb) {
        delegate._removeFile(req, file, cb);
      },
    };
  };

  multer.__mdmMemoryGuardInstalled = true;
}

module.exports = { installUploadMemoryGuard };
