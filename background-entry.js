'use strict';
importScripts(
  'factory-control-protocol.js',
  'factory-control-authorization.js',
  'factory-control-ledger.js',
  'factory-control-instance.js',
  'factory-control-runtime.js',
  'account-budget.js',
  'background.js',
  'account-budget-background.js'
);
globalThis.ChatGPTAutopilotAccountBudgetBackground.install(globalThis.chrome || globalThis.browser);
