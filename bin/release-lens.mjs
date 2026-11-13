#!/usr/bin/env node
// Punto de entrada: ejecuta el CLI en TypeScript con tsx.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const child = spawn(process.execPath, [tsxCli, path.join(here, '..', 'src', 'cli.ts'), ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
