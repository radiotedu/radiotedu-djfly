import { readFile } from 'node:fs/promises';

const base = JSON.parse(await readFile(new URL('./request.json', import.meta.url), 'utf8'));
const limit = value => Math.max(0, Math.min(1, value));

export function musicScenarios() {
  const cases = [];
  const add = (id, description, edit) => {
    const request = structuredClone(base);
    request.seed = 42;
    request.state.revision = `validation-${id}`;
    edit(request);
    cases.push({ id, description, request });
  };
  add('A', 'Conservative groove: modest tempo differences, stable set energy and conservative effects.', request => {
    request.state.requestedEnergyDirection = 0;
    request.state.setEnergy = 0.56;
    request.state.maxShowOff = 0.05;
    request.state.transitionOpportunity = 0.5;
  });
  add('B', 'Energy increase: compatible, louder and rhythmically denser candidates, requested upward direction.', request => {
    request.current.energy = 0.62;
    request.state.setEnergy = 0.66;
    request.state.requestedEnergyDirection = 0.8;
    for (const track of request.pool) {
      track.energy = limit(track.energy + 0.08);
      track.rhythmicDensity = limit(track.rhythmicDensity + 0.08);
      track.bassEnergy = limit(track.bassEnergy + 0.06);
      track.loudnessLufs = Math.min(-6, track.loudnessLufs + 1);
    }
  });
  add('C', 'Risk boundary: an incompatible high-energy track is offered but must be excluded before neural evaluation.', request => {
    request.state.requestedEnergyDirection = 0.9;
    request.state.setEnergy = 0.68;
    request.state.transitionOpportunity = 0.95;
    request.pool[0].bpm = 135;
    request.pool[0].energy = 0.8;
    request.pool[0].rhythmicDensity = 0.95;
    request.pool[0].highEnergy = 0.75;
  });
  add('D', 'Long smooth blend: lower set energy, available 32-bar phrases and only conservative techniques.', request => {
    request.state.setEnergy = 0.45;
    request.state.requestedEnergyDirection = -0.5;
    request.state.transitionOpportunity = 0.7;
    request.state.maxShowOff = 0.05;
    request.capabilities = ['clean-blend', 'long-eq-blend'];
    for (const track of request.pool) {
      track.availableBlendBars = 32;
      track.energy = limit(track.energy - 0.08);
      track.rhythmicDensity = limit(track.rhythmicDensity - 0.1);
      track.highEnergy = limit(track.highEnergy - 0.12);
      track.spectralCentroidHz *= 0.75;
    }
  });
  add('E', 'Short aggressive opportunity: four-bar phrases, reliable grids, sufficient headroom and supported short effects.', request => {
    request.current.availableBlendBars = 4;
    request.state.transitionOpportunity = 1;
    request.state.headroomDb = 8;
    request.state.maxShowOff = 1;
    request.state.requestedEnergyDirection = 0.6;
    request.state.setEnergy = 0.64;
    for (const track of request.pool) {
      track.availableBlendBars = 4;
      track.rhythmicDensity = limit(track.rhythmicDensity + 0.1);
      track.spectralFlatness = limit(track.spectralFlatness + 0.1);
    }
  });
  return cases;
}
