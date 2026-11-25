import { describe, expect, it } from 'vitest';
import { formatAvgCycleDays } from './format-cycle-days';

describe('formatAvgCycleDays', () => {
  it('shows a dash when there is no measurement', () => {
    expect(formatAvgCycleDays(null)).toBe('—');
    expect(formatAvgCycleDays(0)).toBe('—');
    expect(formatAvgCycleDays(-1)).toBe('—');
  });

  it('never prints 0.0d for a tiny positive average', () => {
    expect(formatAvgCycleDays(0.0001)).toBe('<0.1d');
  });

  it('formats ordinary values to one decimal', () => {
    expect(formatAvgCycleDays(2.54)).toBe('2.5d');
  });
});
