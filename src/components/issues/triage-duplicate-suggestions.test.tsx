import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUGGESTION_DEBOUNCE_MS, TriageDuplicateSuggestions } from './triage-duplicate-suggestions';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ workspace: 'ws' }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/issue-nav', () => ({ buildIssueHref: (_w: string, id: string) => `/i/${id}` }));

const gqlQuery = vi.fn();
vi.mock('@/lib/graphql', () => ({ gqlQuery: (...a: unknown[]) => gqlQuery(...a) }));

const suggestion = (id: string, extra: Record<string, unknown> = {}) => ({
  inTriage: false,
  issue: { id, identifier: `ENG-${id}`, title: `Title ${id}` },
  matchedTerms: ['login', 'crash'],
  score: 0.5,
  ...extra,
});

function ui(props: Partial<React.ComponentProps<typeof TriageDuplicateSuggestions>> = {}) {
  return (
    <TriageDuplicateSuggestions
      disabled={false}
      issueId="a"
      issueTitle="Login crash"
      onMarkDuplicate={vi.fn()}
      {...props}
    />
  );
}

beforeEach(() => {
  gqlQuery.mockReset();
});

describe('TriageDuplicateSuggestions', () => {
  it('renders nothing while loading and when there are no suggestions', async () => {
    gqlQuery.mockResolvedValue([]);
    const { container } = render(ui());
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(gqlQuery).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('lists suggestions with matched terms, an in-triage badge and the language hint', async () => {
    gqlQuery.mockResolvedValue([suggestion('1'), suggestion('2', { inTriage: true })]);
    render(ui());
    expect(await screen.findAllByTestId('triage-duplicate-suggestion')).toHaveLength(2);
    expect(screen.getAllByText('settings.triage.duplicateMatchedTerms:login, crash')).toHaveLength(
      2,
    );
    expect(screen.getAllByText('settings.triage.inTriage')).toHaveLength(1);
    expect(screen.getByText('settings.triage.suggestionsLanguageHint')).toBeInTheDocument();
  });

  it('passes the chosen issue to onMarkDuplicate and honours disabled', async () => {
    gqlQuery.mockResolvedValue([suggestion('1')]);
    const onMarkDuplicate = vi.fn();
    const { rerender } = render(ui({ onMarkDuplicate }));
    const button = await screen.findByRole('button', {
      name: 'settings.triage.markDuplicateOf:ENG-1',
    });
    fireEvent.click(button);
    expect(onMarkDuplicate).toHaveBeenCalledWith({
      id: '1',
      identifier: 'ENG-1',
      title: 'Title 1',
    });
    rerender(ui({ disabled: true, onMarkDuplicate }));
    expect(button).toBeDisabled();
  });

  it('shows a retry (not an empty state) when the lookup fails, and recovers on retry', async () => {
    gqlQuery.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([suggestion('1')]);
    render(ui());
    const retry = await screen.findByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(await screen.findByTestId('triage-duplicate-suggestion')).toBeInTheDocument();
  });

  it('debounces focus changes: only the settled issue is queried, and old rows never show', async () => {
    gqlQuery.mockImplementation(async (_q: string, vars: { issueId: string }) => [
      suggestion(vars.issueId),
    ]);
    const { rerender } = render(ui({ issueId: 'a' }));
    await screen.findByTestId('triage-duplicate-suggestion');
    gqlQuery.mockClear();

    // Hold J: five focus changes inside the quiet period.
    for (const id of ['b', 'c', 'd', 'e', 'f']) {
      rerender(ui({ issueId: id, issueTitle: `Title ${id}` }));
      // The previous issue's suggestions must not stay on screen under the new one.
      expect(screen.queryByTestId('triage-duplicate-suggestion')).toBeNull();
    }
    expect(gqlQuery).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise(r => setTimeout(r, SUGGESTION_DEBOUNCE_MS + 50));
    });
    expect(gqlQuery).toHaveBeenCalledTimes(1);
    expect(gqlQuery.mock.calls[0][1]).toEqual({ issueId: 'f' });
    expect(await screen.findByText('Title f')).toBeInTheDocument();
  });
});
