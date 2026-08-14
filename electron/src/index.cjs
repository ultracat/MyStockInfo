// Electron's `main` entry must be plain JS. This registers tsx's CommonJS
// loader so the rest of the app (main.ts, and the backend package it
// imports) can be written in TypeScript without a separate compile step
// during development.
require('tsx/cjs');
require('./main.ts');
