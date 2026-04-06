# Sprint 9-10: Search & Command Palette
## Issue Tracker — Linear Rebuild

**Phase:** 1 (Foundation)  
**Weeks:** 17-20  
**Goal:** Fast search and keyboard-first navigation via command palette

**Prerequisites:** Sprint 7-8 (sync engine, MobX stores — search reads from local stores where possible)

---

## 1. Overview

This sprint adds PostgreSQL full-text search, issue ID instant jump, the Cmd+K command palette, and a comprehensive global keyboard shortcuts system. The command palette is the primary power-user navigation tool and must feel instant (<100ms for all interactions).

---

## 2. Patterns to Establish

### 2.1 Local-First Search Pattern

For entities already in the local MobX store, search locally first. Fall back to server for deep text search (descriptions, comments):

```typescript
// Local fuzzy search (instant, for titles/identifiers)
const localResults = issueStore.search(query);

// Server search (for full-text across descriptions)
const serverResults = await graphqlClient.query({ query: SEARCH_ISSUES, variables: { query } });

// Merge and deduplicate
```

### 2.2 Command Palette Pattern

The command palette is a layered modal with nested flows:

```
Layer 0: Top-level search (issues, projects, actions)
Layer 1: Action sub-menus (e.g., "Set status" → list of statuses)
Layer 2: Confirmation (if needed)
```

Navigation: Arrow keys to move, Enter to select, Escape to go back one layer (or close), Tab to autocomplete.

### 2.3 Keyboard Shortcut Registration Pattern

Use a centralized shortcut registry to avoid conflicts:

```typescript
// src/hooks/use-hotkeys.ts
// Register shortcuts with scope awareness (global, list, detail, modal)
useHotkeys('c', createIssue, { scope: 'global', when: () => !isModalOpen });
useHotkeys('j', selectNext, { scope: 'list' });
```

---

## 3. Database Changes

### Full-Text Search Index

The GIN index on issues was defined in the schema (Sprint 5-6). This sprint adds the `searchIssues` query that uses it.

If using PostgreSQL `to_tsvector`:
```sql
-- Already in DATABASE_SCHEMA.md
CREATE INDEX idx_issues_search ON issues
    USING GIN (to_tsvector('english', title || ' ' || COALESCE(description, '')));
```

Ensure this index exists in the Prisma migration. Prisma doesn't natively support GIN indexes, so add via a raw SQL migration:

```bash
npx prisma migrate dev --name add_fulltext_search
```

Then manually edit the migration SQL to include the GIN index.

---

## 4. GraphQL API

**Ref:** `docs/API_DESIGN.md` section 5 (Queries — searchIssues)

### Queries

```graphql
type Query {
  searchIssues(
    query: String!
    first: Int
    includeArchived: Boolean
  ): IssueConnection!

  searchProjects(
    query: String!
    first: Int
  ): ProjectConnection!   # Placeholder — projects added in Sprint 13-14
}
```

### Server Implementation

```typescript
// src/server/services/search.service.ts
async searchIssues(orgId: string, query: string, first: number = 20): Promise<Issue[]> {
  // 1. Check for issue ID pattern (e.g., "ENG-123")
  const idMatch = query.match(/^([A-Z]+-\d+)$/);
  if (idMatch) {
    const issue = await this.prisma.issue.findFirst({
      where: { organizationId: orgId, identifier: idMatch[1] },
    });
    return issue ? [issue] : [];
  }

  // 2. Full-text search
  return this.prisma.$queryRaw`
    SELECT * FROM issues
    WHERE organization_id = ${orgId}::uuid
      AND to_tsvector('english', title || ' ' || COALESCE(description, ''))
          @@ plainto_tsquery('english', ${query})
    ORDER BY ts_rank(
      to_tsvector('english', title || ' ' || COALESCE(description, '')),
      plainto_tsquery('english', ${query})
    ) DESC
    LIMIT ${first}
  `;
}
```

---

## 5. Command Palette

### 5.1 Structure

```
CommandPalette (Cmd+K)
├── SearchInput (with icon, placeholder text changes per context)
├── ResultsList
│   ├── RecentSection (shown on empty query)
│   │   └── RecentItem (last 5 visited issues/projects)
│   ├── IssueResults (matched issues)
│   │   └── IssueResultRow (identifier, title, team, status icon)
│   ├── ActionResults (matched actions)
│   │   └── ActionRow (icon, label, shortcut hint)
│   └── EmptyState
└── Footer (keyboard hints: ↑↓ Navigate, ↵ Select, esc Close)
```

### 5.2 Available Actions

| Action | Keywords | Behavior |
|--------|----------|----------|
| Create issue | "create issue", "new issue" | Opens create issue modal |
| Set status | "set status", "change status" | → Sub-menu: list of statuses |
| Set assignee | "assign", "set assignee" | → Sub-menu: list of users |
| Set priority | "priority", "set priority" | → Sub-menu: priority levels |
| Add label | "label", "add label" | → Sub-menu: list of labels |
| Go to My Issues | "my issues" | Navigate to my issues |
| Go to Inbox | "inbox", "notifications" | Navigate to inbox |
| Go to Team | "team [name]" | Navigate to team |
| Go to Settings | "settings" | Navigate to settings |

### 5.3 Fuzzy Matching

Use a lightweight fuzzy match algorithm (e.g., fuse.js-style scoring) against:
- Issue identifiers (ENG-123)
- Issue titles
- Project names
- Action labels

---

## 6. Keyboard Shortcuts

### 6.1 Global Shortcuts

| Key | Action | Scope |
|-----|--------|-------|
| `Cmd+K` / `Ctrl+K` | Open command palette | Global |
| `C` | Create new issue | Global (not in input) |
| `I` | Go to inbox | Global (not in input) |

### 6.2 List View Shortcuts

| Key | Action |
|-----|--------|
| `J` | Select next issue |
| `K` | Select previous issue |
| `X` | Toggle selection checkbox |
| `Enter` | Open selected issue detail |
| `Escape` | Clear selection / close detail |

### 6.3 Issue Context Shortcuts (when issue is selected)

| Key | Action |
|-----|--------|
| `S` | Change status |
| `A` | Change assignee |
| `P` | Change priority |
| `L` | Change label |
| `Shift+E` | Set estimate |
| `D` | Set due date |
| `Backspace` / `Delete` | Archive issue |

### 6.4 Multi-Key Shortcuts

| Keys | Action |
|------|--------|
| `G` then `I` | Go to my issues |
| `G` then `N` | Go to inbox |

---

## 7. Frontend Components

### Right-Click Context Menu

```
IssueContextMenu (right-click on issue row)
├── Open issue
├── Open in new tab
├── ─────────────
├── Set status → (submenu)
├── Set assignee → (submenu)
├── Set priority → (submenu)
├── Add label → (submenu)
├── ─────────────
├── Copy issue ID
├── Copy issue URL
├── Copy branch name
├── ─────────────
├── Archive
├── Delete
```

---

## 8. Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/server/services/search.service.ts` | **Create** | Full-text search + ID lookup |
| `src/server/graphql/resolvers/search.ts` | **Create** | searchIssues resolver |
| `prisma/migrations/xxx_add_fulltext_search/migration.sql` | **Create** | GIN index migration |
| `src/components/command-palette/command-palette.tsx` | **Create** | Main palette modal |
| `src/components/command-palette/search-input.tsx` | **Create** | Search input with debounce |
| `src/components/command-palette/results-list.tsx` | **Create** | Virtualized results |
| `src/components/command-palette/issue-result-row.tsx` | **Create** | Issue search result |
| `src/components/command-palette/action-row.tsx` | **Create** | Action search result |
| `src/components/command-palette/sub-menu.tsx` | **Create** | Nested action menu |
| `src/components/issues/issue-context-menu.tsx` | **Create** | Right-click context menu |
| `src/hooks/use-hotkeys.ts` | **Modify** | Full shortcut system with scopes |
| `src/hooks/use-recent-items.ts` | **Create** | Track recently visited items |
| `src/stores/ui-store.ts` | **Modify** | Add commandPaletteOpen, selectedIssueId state |
| `src/lib/fuzzy-search.ts` | **Create** | Lightweight fuzzy matching |

---

## 9. Dependencies to Install

```bash
# No new backend dependencies

# Frontend
yarn add cmdk                      # Command palette primitives (or build custom)
```

---

## 10. Acceptance Criteria

- [ ] `Cmd+K` / `Ctrl+K` opens the command palette
- [ ] Typing an issue ID (e.g., `ENG-123`) instantly shows that issue as the first result
- [ ] Typing a search term returns fuzzy-matched issues from the local store within 50ms
- [ ] Full-text search against descriptions works via server query
- [ ] Enter on an issue result navigates to that issue
- [ ] Action commands (e.g., typing "create issue") appear in results
- [ ] Selecting "Set status" opens a sub-menu with available statuses
- [ ] Escape closes the palette (or goes back from a sub-menu)
- [ ] Arrow keys navigate results, Enter selects
- [ ] `C` shortcut creates an issue (when not focused in an input)
- [ ] `J`/`K` navigate the issue list
- [ ] `S`/`A`/`P`/`L` open respective property editors on the selected issue
- [ ] `G` then `I` navigates to My Issues
- [ ] Right-click on an issue row shows the context menu
- [ ] Context menu actions (set status, copy ID, archive) all work
- [ ] Recent items show on empty command palette query
- [ ] Keyboard shortcuts are disabled when a text input or modal is focused

---

## 11. Cross-References

| Topic | Document | Section |
|-------|----------|---------|
| Search query (GraphQL) | `docs/API_DESIGN.md` | 5. Queries (searchIssues) |
| Full-text search index | `docs/DATABASE_SCHEMA.md` | 2.4 Issues (GIN index) |
| Search requirements | `docs/PRD.md` | Search (<100ms) |
| Keyboard shortcuts spec | `docs/PRD.md` | UX (keyboard-first) |
| Command palette | `docs/ARCHITECTURE.md` | 4.1 (CommandPalette) |
| Routing (navigation targets) | `docs/ARCHITECTURE.md` | 4.3 Routing |
| Linear research — shortcuts | `LINEAR_RESEARCH.md` | UX & Design Patterns (40+ shortcuts) |
