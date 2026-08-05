import { describe, expect, it } from 'vitest';
import { cn, TOUCH_TARGET, TOUCH_TARGET_SQUARE } from './utils';

describe('touch-target constants', () => {
  // 44px is the WCAG 2.5.8 minimum. If either constant stops asserting a
  // height, every icon button in the app silently loses its mobile hit area.
  it('both raise the control to 44px below md', () => {
    expect(TOUCH_TARGET).toContain('max-md:h-11');
    expect(TOUCH_TARGET_SQUARE).toContain('max-md:h-11');
  });

  // The distinction is load-bearing: the reaction bar's trigger renders
  // "🙂 React" and the editor toolbar renders `B`/`I`/`U` glyphs, so the
  // default must set a floor, not a fixed width.
  it('the default sets a width floor, not a fixed width', () => {
    expect(TOUCH_TARGET).toContain('max-md:min-w-11');
    expect(TOUCH_TARGET).not.toContain('max-md:w-11');
  });

  it('the square variant pins an exact width', () => {
    expect(TOUCH_TARGET_SQUARE).toContain('max-md:w-11');
    expect(TOUCH_TARGET_SQUARE).not.toContain('max-md:min-w-11');
  });

  // The default centres its content, which is what lets a bare icon sit in the
  // middle of the enlarged box rather than at its top-left.
  it('the default centres content at the breakpoint', () => {
    expect(TOUCH_TARGET).toContain('max-md:flex');
    expect(TOUCH_TARGET).toContain('max-md:items-center');
    expect(TOUCH_TARGET).toContain('max-md:justify-center');
  });

  // Call sites compose these through cn(); tailwind-merge must not treat the
  // responsive utilities as conflicting with the base ones they sit beside.
  it('survives cn() alongside unprefixed sizing', () => {
    const merged = cn('flex h-6 w-6 items-center justify-center rounded', TOUCH_TARGET_SQUARE);
    expect(merged).toContain('h-6');
    expect(merged).toContain('w-6');
    expect(merged).toContain('max-md:h-11');
    expect(merged).toContain('max-md:w-11');
  });
});
