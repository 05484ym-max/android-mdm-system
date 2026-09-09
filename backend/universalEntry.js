'use strict';

require('dotenv').config();

const db = require('./db');
const protectionSync = require('./protectionSync');
const protectionPersistence = require('./protectionPersistence');
const { installProtectionRuntimeBridge } = require('./protectionRuntimeBridge');

installProtectionRuntimeBridge(db, protectionSync, protectionPersistence);

require('./index');
