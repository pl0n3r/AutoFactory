'use strict';
importScripts(
  'account-budget.js',
  'factory-control-protocol.js',
  'factory-control-authorization.js',
  'factory-control-ledger.js',
  'factory-control-instance.js',
  'factory-control-runtime.js',
  'factory-control-instance-transport.js',
  'shared-learning-protocol.js',
  'shared-learning-sync.js',
  'background.js',
  'account-budget-background.js'
);
globalThis.ChatGPTAutopilotAccountBudgetBackground.install(globalThis.chrome || globalThis.browser);
