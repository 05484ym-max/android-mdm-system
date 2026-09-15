'use strict';

require('dotenv').config();

const db = require('./db');
const push = require('./push');
const protectionSync = require('./protectionSync');
const protectionPersistence = require('./protectionPersistence');
const { installProtectionRuntimeBridge } = require('./protectionRuntimeBridge');
const { installFleetCatalogBridge } = require('./fleetCatalogBridge');
const { installReliabilityBridge } = require('./reliabilityBridge');
const { installProtectionAdminRoutes } = require('./protectionAdminRoutes');
const { installProtectionDeviceRoutes } = require('./protectionDeviceRoutes');
const { captureExpressApp } = require('./expressAppCapture');

// Reliability wrappers must be installed before index.js captures references to
// the exported db/push operations used by legacy routes.
installReliabilityBridge(db, push);
installProtectionRuntimeBridge(db, protectionSync, protectionPersistence);
installFleetCatalogBridge(db, push);

// index.js owns the legacy Express app and server startup. Capture that one
// app during module load so additive routes can be added without a risky
// full rewrite of the large legacy entry file.
const app = captureExpressApp(() => require('./index'));
installProtectionAdminRoutes(app, { db, protectionPersistence });
installProtectionDeviceRoutes(app, { db, protectionPersistence });
