/**
 * jsdom test setup — registers @testing-library/jest-dom matchers
 * (toBeInTheDocument, toHaveClass, …) and auto-cleans the DOM between
 * tests. Loaded only by the `dom` vitest project (src/**\/*.test.tsx).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
