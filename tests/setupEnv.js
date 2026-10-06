'use strict';

// Runs before any test module is loaded, so config picks the *_test database.
process.env.NODE_ENV = 'test';
