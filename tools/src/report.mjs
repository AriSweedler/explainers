// Problem collection and the one output format every command uses:
//   file:line: CODE figure-id: message
import { ERROR_CATALOGUE } from '../../lib/spec.js';

export function format({ file, line, code, figureId, message }) {
  return `${file}:${line || 0}: ${code} ${figureId || '-'}: ${message}`;
}

export class Problems {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  error(file, line, code, figureId, message) {
    if (!ERROR_CATALOGUE[code]) throw new Error(`internal: ${code} is not in ERROR_CATALOGUE`);
    this.errors.push({ file, line, code, figureId, message });
  }

  warn(file, line, figureId, message) {
    this.warnings.push({ file, line, code: 'warning', figureId, message });
  }

  get ok() { return this.errors.length === 0; }

  print(stream = process.stderr) {
    for (const w of this.warnings) stream.write(format(w) + '\n');
    for (const e of this.errors) stream.write(format(e) + '\n');
  }
}
