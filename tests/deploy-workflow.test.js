// The Deploy workflow's text holds what a passing fault on GitHub's side needs (#70): a deployment
// that failed is tried again, a bounded number of times, and one that still fails leaves an issue.
// On 2026-11-28 three of six runs failed on «No artifacts named "github-pages"» a moment after the
// upload, nothing tried again, nothing reported it, and the live site stayed on an old build.
// No YAML reader is installed, so a job is read as its lines and a step as its block of text.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..'),
  text = readFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'utf8');

const MAX_TRIES = 3; // the first try and two more: a fault that outlasts them is not a passing one

// a job's text: from its name to the next line at a job's indentation
function job(name) {
  const lines = text.split('\n'),
    first = lines.indexOf(`  ${name}:`);
  assert.notEqual(first, -1, `deploy.yml has no job «${name}»`);
  const rest = lines.slice(first + 1),
    next = rest.findIndex(line => /^ {2}\S/.test(line));
  return rest.slice(0, next === -1 ? rest.length : next).join('\n');
}
// a job's steps, each from its dash to the next step's
const steps = body => body.split(/^ {6}- /m).slice(1);
const field = (step, name) => step.match(new RegExp(`^ *${name}: (.+)$`, 'm'))?.[1];

const deploy = job('deploy'),
  deploySteps = steps(deploy),
  tries = deploySteps.filter(step => /uses: actions\/deploy-pages@/.test(step));

test('a deployment that failed is tried again, a bounded number of times', () => {
  assert.ok(tries.length > 1, 'the deployment has a single try');
  assert.ok(tries.length <= MAX_TRIES, `${tries.length} tries: the retry is not bounded at ${MAX_TRIES}`);
  assert.equal(new Set(tries.map(step => field(step, 'uses'))).size, 1, 'every try runs the same pinned action');
  assert.equal(field(tries[0], 'if'), "steps.tip.outputs.current == 'true'", 'the first try runs for the tip of main only');
  for (const [index, step] of tries.entries()) {
    const last = index === tries.length - 1;
    // a try that may be made again must not fail the job; the last one must
    assert.equal(field(step, 'continue-on-error'), last ? undefined : 'true', `try ${index + 1}`);
    if (!index) continue;
    const failedBefore = `steps.${field(tries[index - 1], 'id')}.outcome == 'failure'`;
    assert.equal(field(step, 'if'), failedBefore, `try ${index + 1} runs only after the try before it failed`);
    const wait = deploySteps[deploySteps.indexOf(step) - 1];
    assert.match(wait, /^ *run: sleep \d+$/m, `try ${index + 1} follows a wait`);
    assert.equal(field(wait, 'if'), failedBefore, `the wait before try ${index + 1} runs only after a failed try`);
  }
});

test('the environment and the read-back take the address from whichever try passed', () => {
  const addresses = tries.map(step => `steps.${field(step, 'id')}.outputs.page_url`).join(' || ');
  assert.ok(deploy.includes(`url: \${{ ${addresses} }}`), 'the environment address');
  const readBack = deploySteps.find(step => step.includes('live_build_check.py'));
  assert.ok(readBack.includes(`PAGE_URL: \${{ ${addresses} }}`), 'the read-back address');
  assert.equal(field(readBack, 'if'), "steps.tip.outputs.current == 'true'");
});

test('a deployment that still fails leaves an issue, from a job that cannot publish', () => {
  const record = job('record');
  assert.equal(field(record, 'needs'), 'deploy');
  const when = field(record, 'if');
  assert.ok(when.includes("needs.deploy.result == 'failure'"), 'the record job runs after a failed deployment');
  assert.ok(when.includes('!cancelled()'), 'a status function, or a failed deployment skips the job');
  assert.match(record, /^ {6}issues: write$/m);
  assert.doesNotMatch(record, /^ {6}(pages|id-token): write$/m, 'the job that records cannot publish');
  assert.doesNotMatch(deploy, /issues: write/, 'the job that publishes writes no issue');
  assert.match(record, /python3 scripts\/upstream_check\.py alert/);
  assert.match(record, /--workflow Deploy .*--sha "\$SHA"/);
  assert.ok(existsSync(path.join(root, 'scripts', 'upstream_check.py')), 'the script the record job runs');
  // the job says whether the commit was the tip of main, so a skipped older commit closes no issue
  assert.match(deploy, /^ {4}outputs:\n {6}current: \$\{\{ steps\.tip\.outputs\.current \}\}$/m);
  assert.ok(when.includes("needs.deploy.outputs.current == 'true'"));
});
