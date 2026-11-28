// The motion lab's arithmetic: what it reports for frames whose motion and flashes are known.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correlation, flashingField, parseArguments, summarise } from '../lab/motion.mjs';

const FPS = 30;
const CELLS = 4;
/** One second and a half of frames; `cellAt(frame)` gives the first cell's luminance, the others stay dark. */
const framesOf = cellAt => [...Array(FPS * 1.5).keys()].map(frame => [cellAt(frame), ...Array(CELLS - 1).fill(0.02)]);

test('the motion lab reads its rhythms and options, and refuses anything else', () => {
  const viewport = { width: 393, height: 852 }; // a phone
  assert.deepEqual(parseArguments(['coco', 'frevo']), { ids: ['coco', 'frevo'], seconds: 3, shots: null, viewport });
  assert.deepEqual(parseArguments(['coco', '--seconds', '1.5', '--shots', 'out']), { ids: ['coco'], seconds: 1.5, shots: 'out', viewport });
  assert.deepEqual(parseArguments(['coco', '--window', '1440x900']).viewport, { width: 1440, height: 900 });
  assert.equal(parseArguments(['coco', '--window', '1440']), null); // a width alone
  assert.equal(parseArguments(['coco', '--window', '0x900']), null);
  assert.equal(parseArguments(['coco', '--window']), null);
  assert.equal(parseArguments([]), null);
  assert.equal(parseArguments(['--seconds', '2']), null); // no rhythm
  assert.equal(parseArguments(['coco', '--seconds']), null); // an option with no value
  assert.equal(parseArguments(['coco', '--frames', '9']), null); // an unknown option
});

test('a still picture has no motion and no flash', () => {
  assert.deepEqual(
    summarise(
      framesOf(() => 0.02),
      FPS,
    ),
    { moving: 0, change: 0, flashes: 0, flashing: 0 },
  );
});

test('a cell that drifts slowly counts as moving and never as a flash', () => {
  const result = summarise(
    framesOf(frame => 0.02 + frame * 0.002),
    FPS,
  );
  assert.equal(result.moving, 1 / CELLS, 'one cell of four changes by a step of lightness in half a second');
  assert.ok(result.change > 0);
  assert.equal(result.flashes, 0);
});

test('a cell that goes bright and dark five times a second is over the limit of three flashes', () => {
  const result = summarise(
    framesOf(frame => (Math.floor(frame / 3) % 2 ? 0.5 : 0.02)),
    FPS,
  );
  assert.equal(result.flashes, 5);
  assert.equal(result.flashing, 1 / CELLS);
  // twice a second, the same change is within the limit
  const slow = summarise(
    framesOf(frame => (Math.floor(frame / 8) % 2 ? 0.5 : 0.02)),
    FPS,
  );
  assert.ok(slow.flashes <= 3 && slow.flashes >= 1, `${slow.flashes} flashes`);
  assert.equal(slow.flashing, 0);
  // a change under 10 % of relative luminance is no flash, however fast
  assert.equal(
    summarise(
      framesOf(frame => (frame % 2 ? 0.1 : 0.02)),
      FPS,
    ).flashes,
    0,
  );
});

test('the correlation is 1 for lists that rise together, -1 for opposite ones, 0 when one does not vary', () => {
  assert.ok(Math.abs(correlation([1, 2, 3], [10, 20, 30]) - 1) < 1e-12);
  assert.ok(Math.abs(correlation([1, 2, 3], [3, 2, 1]) + 1) < 1e-12);
  assert.equal(correlation([1, 2, 3], [5, 5, 5]), 0);
});

// A grid of 8 by 8 cells and a field of 4 by 2: `flashing(x, y, frame)` says whether a cell flashes
// then; a flashing cell goes bright and dark five times a second, the others stay dark.
const GRID = { width: 8, height: 8 };
const FIELD = { width: 4, height: 2 };
const DARK = 0.02,
  BRIGHT = 0.5;
const gridFrames = (flashing, seconds = 2) =>
  [...Array(FPS * seconds).keys()].map(frame =>
    [...Array(GRID.width * GRID.height).keys()].map(i =>
      flashing(i % GRID.width, Math.floor(i / GRID.width), frame) && Math.floor(frame / 3) % 2 ? BRIGHT : DARK,
    ),
  );

/** The field of a picture whose cells flash where `flashing` says, over `seconds`. */
const fieldOf = (flashing, seconds, field = FIELD) => flashingField(gridFrames(flashing, seconds), FPS, GRID, field);

test('cells that flash together are measured as a share of the 10° field they fill most', () => {
  // two cells side by side: a quarter of the 4 by 2 field
  const pair = fieldOf((x, y) => y === 5 && (x === 2 || x === 3));
  assert.equal(pair.share, 2 / 8);
  assert.equal(pair.at, 0);
  assert.ok(pair.row <= 5 && pair.row + pair.rows > 5 && pair.column <= 2 && pair.column + pair.columns > 3, 'the rectangle holds both cells');
  // four cells one over another: only the field on its side holds them all
  const column = fieldOf((x, y) => x === 6 && y >= 1 && y <= 4);
  assert.equal(column.share, 4 / 8);
  assert.deepEqual([column.columns, column.rows], [2, 4]);
  // every cell: the whole field, never more
  assert.equal(fieldOf(() => true).share, 1);
});

test('cells that flash in different seconds are not added together, and no flashing cell gives no place', () => {
  // the left cell flashes in the first second only, the right one in the third only
  const apart = fieldOf((x, y, frame) => y === 0 && ((x === 0 && frame < FPS) || (x === 1 && frame >= 2 * FPS)), 3);
  assert.equal(apart.share, 1 / 8);
  assert.deepEqual(
    fieldOf(() => false),
    { share: 0 },
  );
  // three flashes a second, the limit itself, mark no cell
  const slow = [...Array(FPS * 2).keys()].map(frame => Array(GRID.width * GRID.height).fill(Math.floor(frame / 5) % 2 ? BRIGHT : DARK));
  assert.deepEqual(flashingField(slow, FPS, GRID, FIELD), { share: 0 });
});

test('a field larger than the grid is cut to it, and a run shorter than a second is one window', () => {
  const all = gridFrames(() => true),
    huge = flashingField(all, FPS, GRID, { width: 31, height: 23 });
  assert.equal(huge.share, 1);
  assert.deepEqual([huge.columns, huge.rows], [GRID.width, GRID.height]);
  const half = fieldOf((_x, y) => y < 4, undefined, { width: 31, height: 23 });
  assert.equal(half.share, 1 / 2);
  // 27 frames, under a second: ten changes of a cell are over the limit all the same
  const short = flashingField(all.slice(0, 27), FPS, GRID, FIELD);
  assert.equal(short.share, 1);
  assert.equal(short.at, 0);
  assert.deepEqual(flashingField(all.slice(0, 1), FPS, GRID, FIELD), { share: 0 });
});

test('the summary holds the field when it is given the grid', () => {
  const area = { grid: GRID, field: FIELD };
  assert.equal(
    summarise(
      gridFrames((x, y) => y === 5 && x < 2),
      FPS,
      area,
    ).field.share,
    2 / 8,
  );
  assert.equal(
    'field' in
      summarise(
        gridFrames(() => true),
        FPS,
      ),
    false,
  );
});
