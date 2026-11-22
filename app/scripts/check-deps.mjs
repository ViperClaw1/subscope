// Fails if any analytics / crash-reporting SDK is anywhere in the installed tree.
import { execSync } from 'node:child_process';

const banned = /^(@sentry\/|firebase$|@firebase\/|@react-native-firebase\/|.*amplitude|@segment\/|analytics-react-native|.*bugsnag|@datadog\/|appcenter)/;
// npm ls exits non-zero on peer warnings; we only want the JSON
let out;
try { out = execSync('npm ls --all --json', { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
catch (e) { out = e.stdout.toString(); }

const hits = new Set();
(function walk(deps = {}) {
  for (const [name, d] of Object.entries(deps)) {
    if (banned.test(name)) hits.add(name);
    walk(d.dependencies);
  }
})(JSON.parse(out).dependencies);

if (hits.size) { console.error(`banned deps: ${[...hits].join(', ')}`); process.exit(1); }
console.log('deps OK');
