'use strict';

require('dotenv').config();

const db = require('./db');
const push = require('./push');
const protectionSync = require('./protectionSync');
const protectionPersistence = require('./protectionPersistence');
const frpPersistence = require('./frpPersistence');
const { installProtectionRuntimeBridge } = require('./protectionRuntimeBridge');
const { installProtectionAdminRoutes } = require('./protectionAdminRoutes');
const { installProtectionDeviceRoutes } = require('./protectionDeviceRoutes');
const { installFrpRoutes } = require('./frpRoutes');
const { captureExpressApp } = require('./expressAppCapture');

installProtectionRuntimeBridge(db, protectionSync, protectionPersistence);

// index.js owns the legacy Express app and server startup. Capture that one
// app during module load so additive routes can be installed without a risky
// full rewrite of the large legacy entry file.
const app = captureExpressApp(() => require('./index'));
installProtectionAdminRoutes(app, { db, protectionPersistence });
installProtectionDeviceRoutes(app, { db, protectionPersistence });
installFrpRoutes(app, { db, frpPersistence, push });
