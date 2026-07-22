#!/usr/bin/env node
'use strict';
// Prints the command that runs the draw-your-font CLI, trying:
// 1. the monorepo layout (this skill lives inside the draw-your-font repo)
// 2. a globally installed draw-your-font
// 3. npx fallback (works once the package is published to npm)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoCli = path.join(__dirname, '..', '..', '..', 'src', 'cli.js');
if (fs.existsSync(repoCli)) {
  try {
    // deps may live next to the package OR hoisted in a consumer's node_modules
    require.resolve('sharp', { paths: [path.dirname(repoCli)] });
    console.log(`node ${repoCli}`);
    process.exit(0);
  } catch {
    console.error(`Found ${path.dirname(path.dirname(repoCli))} but its dependencies are missing - run: npm install there`);
    process.exit(1);
  }
}
try {
  execSync('draw-your-font --help', { stdio: 'ignore' });
  console.log('draw-your-font');
  process.exit(0);
} catch {
  console.log('npx -y draw-your-font');
}
