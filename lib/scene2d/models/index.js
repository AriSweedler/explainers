// lib/scene2d/models/index.js — the library models by MODELS name.
// Each computes outputs named exactly as lib/spec.js declares.
import { kepler } from './kepler.js';
import { twobody } from './twobody.js';
import { cam } from './cam.js';
import { lunar } from './lunar.js';

export const MODEL_FUNCTIONS = Object.freeze({ kepler, twobody, cam, lunar });

// Adds <model>.<output> entries to the scope from the model's params
// (expressions over the rest of the scope, compiled once by the caller).
export function applyModel(model, paramGetters, scope) {
  const params = {};
  for (const [k, g] of Object.entries(paramGetters)) params[k] = g(scope);
  const outputs = MODEL_FUNCTIONS[model.name](params);
  for (const [k, v] of Object.entries(outputs)) scope.set(`${model.name}.${k}`, v);
}
