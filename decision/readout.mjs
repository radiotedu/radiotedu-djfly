import { mapping } from '../connectome/load.mjs';
import { clamp01 } from '../music/candidates.mjs';

export function readouts(graph, state) {
  const means = Object.fromEntries(mapping.channels.map(channel => [channel,
    graph.outputs[channel].reduce((sum, index) => sum + state[index], 0) / graph.outputs[channel].length]));
  const baseline = Object.values(means).reduce((sum, value) => sum + value, 0) / mapping.channels.length;
  const channels = Object.fromEntries(mapping.channels.map(channel => [channel,
    clamp01(0.5 + 0.5 * Math.tanh(mapping.model.readoutGain * (means[channel] - baseline)))]));
  return { channels, means, baseline };
}

export function chooseStrategy(strategies, channels) {
  if (!Array.isArray(strategies) || !strategies.length) throw new Error('No safe transition is available.');
  const targetBars = 4 + 28 * channels.blend;
  const choices = strategies.flatMap(strategy => strategy.bars.map(bars => ({
    strategyId: strategy.id, bars,
    loss: Math.abs(strategy.risk - channels.risk)
      + Math.abs(strategy.aggressiveness - channels.transitionAggressiveness)
      + Math.abs(strategy.showOff - channels.showOff) + Math.abs(bars - targetBars) / 32
  })));
  choices.sort((a, b) => a.loss - b.loss || (a.strategyId < b.strategyId ? -1 : a.strategyId > b.strategyId ? 1 : a.bars - b.bars));
  return choices[0];
}
