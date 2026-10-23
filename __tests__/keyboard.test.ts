import { revealDelta, sheetBodyMaxHeight } from '@/lib/keyboard';

test('revealDelta scrolls just enough to clear the keyboard, never past the top margin', () => {
  const base = { windowHeight: 800, keyboard: 300, minTop: 60 };
  expect(revealDelta({ ...base, top: 100, height: 300 })).toBe(0); // fits above the keyboard (bottom 400 <= 488)
  expect(revealDelta({ ...base, top: 300, height: 300 })).toBe(112); // bottom 600 vs 488
  expect(revealDelta({ ...base, top: 200, height: 700 })).toBe(140); // taller than the room: stop at minTop
  expect(revealDelta({ ...base, top: 50, height: 700 })).toBe(0);
});

test('the sheet body shrinks with the keyboard', () => {
  expect(sheetBodyMaxHeight(800, 0)).toBe(530);
  expect(sheetBodyMaxHeight(800, 300)).toBe(275);
  expect(sheetBodyMaxHeight(300, 280)).toBe(120);
});
