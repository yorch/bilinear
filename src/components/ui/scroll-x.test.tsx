// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollX } from './scroll-x';

function setMetrics(el: HTMLElement, m: { client: number; scroll: number; left: number }) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: m.client });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: m.scroll });
  el.scrollLeft = m.left;
}

const edge = (c: HTMLElement, which: 'start' | 'end') =>
  c.querySelector(`[data-edge="${which}"]`) as HTMLElement;

describe('ScrollX', () => {
  it('fades the trailing edge when content overflows, and the leading edge once scrolled', () => {
    const { container } = render(
      <ScrollX>
        <div>wide</div>
      </ScrollX>,
    );
    const scroller = container.querySelector('.overflow-x-auto') as HTMLElement;
    setMetrics(scroller, { client: 300, left: 0, scroll: 640 });
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(edge(container, 'end').className).toContain('opacity-100');
    expect(edge(container, 'start').className).toContain('opacity-0');

    setMetrics(scroller, { client: 300, left: 340, scroll: 640 });
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(edge(container, 'end').className).toContain('opacity-0');
    expect(edge(container, 'start').className).toContain('opacity-100');
  });

  it('shows no fade when nothing overflows', () => {
    const { container } = render(
      <ScrollX>
        <div>narrow</div>
      </ScrollX>,
    );
    const scroller = container.querySelector('.overflow-x-auto') as HTMLElement;
    setMetrics(scroller, { client: 300, left: 0, scroll: 300 });
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(edge(container, 'end').className).toContain('opacity-0');
    expect(edge(container, 'start').className).toContain('opacity-0');
  });
});
