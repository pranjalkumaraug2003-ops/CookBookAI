// Writes synthetic cooker whistles and kitchen noises to qa/out/whistles/*.wav, plus expected.json.
// Play them through the speakers (or a phone held near the laptop) while the app listens on the cooker step.
import { writeWav, whistleSet } from './lib/audio.mjs';
import { out, saveJson } from './lib/common.mjs';
const list = whistleSet().map(([name, samples, expected, note]) => { writeWav(out('whistles', `${name}.wav`), samples); return { file: `whistles/${name}.wav`, expectedWhistles: expected, seconds: Math.round(samples.length / 48000), note }; });
saveJson('whistles/expected', list);
