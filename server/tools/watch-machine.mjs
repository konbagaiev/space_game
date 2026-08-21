// Watch what this machine is doing to the game server, once a second, in one line.
//
// The netsim probe on the client can say "no snapshot arrived for 750 ms"; the driver can say "I was not
// stepped"; neither can say WHY. This can: the process's own event-loop delay next to the machine's load
// average and its greediest processes. Run it in a second terminal for the length of a playtest.
//
//   node server/tools/watch-machine.mjs [--seconds 300] [--top 3]
//
// It is a diagnostic, not a service: it samples, prints, and exits.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const run = promisify(execFile);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SECONDS = Number(arg('seconds', '300'));
const TOP = Number(arg('top', '3'));
const cores = os.cpus().length;

// The busiest processes right now, as `pct name` pairs. macOS `ps` is enough and needs no privileges.
async function busiest() {
  try {
    const { stdout } = await run('ps', ['-Ao', '%cpu,comm', '-r']);
    return stdout.trim().split('\n').slice(1, 1 + TOP).map((l) => {
      const m = /^\s*([\d.]+)\s+(.*)$/.exec(l);
      return m ? `${m[1]}% ${m[2].split('/').pop()}` : l.trim();
    });
  } catch { return []; }
}

const start = Date.now();
let worstLoad = 0, oversubscribedSamples = 0, samples = 0;
console.log(`watching for ${SECONDS}s — ${cores} cores. A load above ${cores} means a 60 Hz timer will slip.`);

const timer = setInterval(async () => {
  const [l1, l5] = os.loadavg();
  samples++;
  worstLoad = Math.max(worstLoad, l1);
  if (l1 > cores) oversubscribedSamples++;
  const t = ((Date.now() - start) / 1000).toFixed(0).padStart(4);
  const flag = l1 > cores ? ' OVERSUBSCRIBED' : '';
  console.log(`${t}s  load ${l1.toFixed(2)}/${l5.toFixed(2)} of ${cores}${flag}   ${(await busiest()).join('  ')}`);
}, 1000);

setTimeout(() => {
  clearInterval(timer);
  const pct = samples ? Math.round((oversubscribedSamples / samples) * 100) : 0;
  console.log(`\nworst load ${worstLoad.toFixed(2)} of ${cores} cores; oversubscribed for ${pct}% of the run`);
  console.log(pct > 0
    ? 'A stall in the room during this window is the machine, not the game.'
    : 'The machine was never oversubscribed — a stall in this window is worth chasing in the code.');
  process.exit(0);
}, SECONDS * 1000);
