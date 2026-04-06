# Sprint 11-12: Polish & Performance
## Issue Tracker — Linear Rebuild

**Phase:** 1 (Foundation)  
**Weeks:** 11-12  
**Goal:** Production-ready Alpha release with polish, theming, performance, testing, and observability

**Prerequisites:** Sprints 1-10 (all foundation features complete)

---

## 1. Overview

This sprint hardens everything built in Phase 1 into a production-ready Alpha. No new features — focus on visual polish (dark mode, loading states, error handling), performance optimization (bundle size, virtualization tuning), end-to-end testing, rate limiting, and observability. This sprint also documents all established patterns for Phase 2+ development.

---

## 2. Patterns to Establish

### 2.1 Pattern Documentation

**This is a critical deliverable of this sprint.** Create a `docs/PATTERNS.md` that documents all patterns established during Phase 1, so Phase 2+ sub-agents can follow them consistently. Include:

1. **Project structure** — directory conventions, file naming
2. **Prisma model conventions** — UUID PKs, `@@map`, `@map`, soft delete, timestamps
3. **GraphQL resolver pattern** — thin resolver → service → Prisma
4. **Service layer pattern** — constructor injection, transaction usage
5. **Error handling** — GraphQL error codes, when to throw
6. **Authorization** — `requireAuth`, `requireOrgRole`, `requireTeamMember`
7. **MobX store pattern** — object pool, computed getters, `applySyncAction`
8. **Component patterns** — property popovers, list view, detail panel
9. **Keyboard shortcut registration** — `useHotkeys` usage
10. **Testing patterns** — E2E structure, API testing approach
11. **Sync integration** — how new entities integrate with the sync engine

This document becomes the onboarding guide for all future sprint work.

### 2.2 Theme System Pattern

CSS custom properties for all design tokens:

```css
/* src/app/globals.css */
:root {
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f9fafb;
  --color-bg-tertiary: #f3f4f6;
  --color-text-primary: #111827;
  --color-text-secondary: #6b7280;
  --color-border: #e5e7eb;
  --color-accent: #5e6ad2;
  /* ... all design tokens */
}

.dark {
  --color-bg-primary: #1a1a2e;
  --color-bg-secondary: #16213e;
  --color-bg-tertiary: #0f3460;
  --color-text-primary: #e5e5e5;
  --color-text-secondary: #a0a0a0;
  --color-border: #2a2a4a;
  --color-accent: #7c83db;
}
```

### 2.3 Loading State Pattern

Skeleton shimmer animations for all data-dependent views:

```typescript
// Pattern: skeleton component for each entity
<IssueSkeleton />       // Shimmer row matching issue-row dimensions
<SidebarSkeleton />     // Shimmer matching sidebar shape
<DetailPanelSkeleton /> // Shimmer matching detail panel layout
```

### 2.4 Error Boundary Pattern

```typescript
// Wrap each major section independently
<ErrorBoundary fallback={<SectionError onRetry={refetch} />}>
  <IssueListView />
</ErrorBoundary>
```

### 2.5 Toast Notification Pattern

```typescript
// Centralized toast system for user feedback
toast.success('Issue created');
toast.error('Failed to update issue');
toast.info('You are offline. Changes will sync when reconnected.');
```

---

## 3. Dark Mode / Theme Implementation

### 3.1 System Preference Detection

```typescript
// src/hooks/use-theme.ts
type Theme = 'light' | 'dark' | 'system';

function useTheme() {
  const [theme, setTheme] = useState<Theme>('system');
  // Persist to localStorage
  // Apply class to <html> element
  // Listen to prefers-color-scheme media query for 'system' mode
}
```

### 3.2 Scope

Apply dark mode to:
- All existing UI: sidebar, list view, detail panel, modals, popovers
- Command palette
- Auth pages
- Settings pages
- Toast notifications
- Context menus

---

## 4. Performance Optimization

### 4.1 Bundle Analysis

```bash
# Add to package.json scripts
"analyze": "ANALYZE=true next build"
```

Install `@next/bundle-analyzer` and identify:
- Largest chunks
- Unused imports
- Dependencies that can be lazy-loaded

### 4.2 Code Splitting

- Lazy-load the command palette (`React.lazy`)
- Lazy-load the detail panel
- Lazy-load settings pages
- Dynamic import for heavy libs (date picker, DnD)

### 4.3 Virtualization Tuning

- Profile IssueListView with 10,000 issues
- Tune `overscan` value for smooth scrolling
- Ensure row height measurements are cached
- Test group expand/collapse performance

### 4.4 Sync Performance

- Profile bootstrap time for 10,000 issues
- Optimize IndexedDB bulk writes (use `bulkPut`)
- Profile WebSocket message handling throughput

---

## 5. End-to-End Tests

### 5.1 Test Framework

Use Playwright for E2E testing:

```bash
yarn add -D @playwright/test
npx playwright install
```

### 5.2 Critical Path Tests

| Test | What it validates |
|------|-------------------|
| `auth.spec.ts` | Email login → verify code → see workspace |
| `team-crud.spec.ts` | Create team → verify states seeded → edit settings |
| `issue-crud.spec.ts` | Create issue → verify in list → edit fields → archive |
| `issue-list.spec.ts` | Group by status → expand/collapse → sort → filter |
| `sync.spec.ts` | Create issue in tab A → appears in tab B |
| `offline.spec.ts` | Go offline → create issue → go online → verify synced |
| `command-palette.spec.ts` | Cmd+K → search → navigate → action commands |
| `keyboard.spec.ts` | J/K navigation → C create → S/A/P property changes |

### 5.3 Test Structure

```
tests/
├── e2e/
│   ├── auth.spec.ts
│   ├── team-crud.spec.ts
│   ├── issue-crud.spec.ts
│   ├── issue-list.spec.ts
│   ├── sync.spec.ts
│   ├── offline.spec.ts
│   ├── command-palette.spec.ts
│   └── keyboard.spec.ts
├── fixtures/
│   ├── auth.ts            # Login helper
│   └── seed.ts            # DB seed for tests
└── playwright.config.ts
```

---

## 6. API Rate Limiting

**Ref:** `docs/API_DESIGN.md` section 12 (Rate Limiting)

### Implementation

```typescript
// src/server/middleware/rate-limit.ts
// Redis-backed rate limiting

// Per-user limits:
// - 5,000 requests per hour
// - 250,000 complexity points per hour

// Response headers:
// X-RateLimit-Requests-Limit: 5000
// X-RateLimit-Requests-Remaining: N
// X-RateLimit-Requests-Reset: <unix-timestamp>
// X-Complexity: N
// X-RateLimit-Complexity-Limit: 250000
// X-RateLimit-Complexity-Remaining: N

// Exceeded → HTTP 400 with { errors: [{ extensions: { code: "RATELIMITED" } }] }
```

### Complexity Calculation

- Each property: 0.1 points
- Each object: 1 point
- Connections: multiply child complexity by `first` argument (default 50)
- Max single query: 10,000 points

---

## 7. Observability

### 7.1 Error Tracking (Sentry)

```bash
yarn add @sentry/nextjs
```

- Initialize in `src/app/layout.tsx` (client) and `instrumentation.ts` (server)
- Capture unhandled exceptions
- Capture GraphQL errors with context (query, variables, user ID)
- Capture sync engine errors

### 7.2 Logging

Structured JSON logging for server-side:

```typescript
// src/server/lib/logger.ts
// Use pino or similar structured logger
// Log: auth events, mutation executions, sync actions, errors
```

---

## 8. Responsive Layout

- Sidebar: collapsible on screens < 1024px
- Toggle button + keyboard shortcut (`Cmd+\` or `Cmd+B`)
- Detail panel: full-screen on mobile, side panel on desktop
- List view: hide optional columns on narrow screens

---

## 9. Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `docs/PATTERNS.md` | **Create** | Document all Phase 1 patterns for future sprints |
| `src/app/globals.css` | **Modify** | Add CSS custom properties for light/dark theme |
| `src/hooks/use-theme.ts` | **Create** | Theme state management |
| `src/components/theme-toggle.tsx` | **Create** | Light/dark/system toggle |
| `src/components/ui/skeleton.tsx` | **Create** | Skeleton shimmer component |
| `src/components/ui/toast.tsx` | **Create** | Toast notification system |
| `src/components/error-boundary.tsx` | **Create** | Error boundary with retry |
| `src/components/layouts/sidebar.tsx` | **Modify** | Add collapse, dark mode, polish |
| `src/server/middleware/rate-limit.ts` | **Create** | Redis-backed rate limiter |
| `src/server/lib/logger.ts` | **Create** | Structured logging |
| `src/app/layout.tsx` | **Modify** | Add Sentry, theme provider |
| `instrumentation.ts` | **Create** | Sentry server-side init |
| `next.config.ts` | **Modify** | Bundle analyzer, Sentry config |
| `tests/e2e/*.spec.ts` | **Create** | All E2E test files (8 test files) |
| `tests/fixtures/auth.ts` | **Create** | Auth test helper |
| `tests/fixtures/seed.ts` | **Create** | DB seeding for tests |
| `playwright.config.ts` | **Create** | Playwright configuration |
| `package.json` | **Modify** | Add analyze, test:e2e scripts |

---

## 10. Dependencies to Install

```bash
# Observability
yarn add @sentry/nextjs
yarn add pino pino-pretty          # Structured logging

# Testing
yarn add -D @playwright/test

# Bundle analysis
yarn add -D @next/bundle-analyzer

# Toast notifications (or use shadcn sonner)
npx shadcn@latest add sonner
```

---

## 11. Acceptance Criteria

### Polish
- [ ] Dark mode toggle works (light/dark/system)
- [ ] All existing UI renders correctly in both light and dark modes
- [ ] Skeleton loading states show on initial load (before bootstrap completes)
- [ ] Error boundaries catch and display errors with retry button
- [ ] Toast notifications appear for: issue created, issue updated, issue archived, error states
- [ ] Sidebar collapses on narrow screens and via keyboard shortcut

### Performance
- [ ] Lighthouse performance score > 90 on the issues list page
- [ ] Scrolling 10,000 issues at 60fps (no jank)
- [ ] Initial bootstrap of 10,000 issues completes in < 5 seconds
- [ ] Bundle size: main JS < 200KB gzipped
- [ ] Code splitting: command palette and detail panel lazy-loaded

### Testing
- [ ] All 8 E2E test suites pass
- [ ] Auth flow E2E: login → verify → workspace
- [ ] Issue CRUD E2E: create → edit → archive
- [ ] Sync E2E: cross-tab real-time update
- [ ] Tests run in CI (GitHub Actions)

### Rate Limiting
- [ ] Rate limit headers present on all GraphQL responses
- [ ] Exceeding 5,000 req/hr returns RATELIMITED error
- [ ] Complexity calculation correctly counts nested connections

### Observability
- [ ] Sentry captures unhandled errors (client + server)
- [ ] Server logs are structured JSON with request context
- [ ] GraphQL errors include query name and user context in Sentry

### Pattern Documentation
- [ ] `docs/PATTERNS.md` exists and covers all 11 pattern areas listed in section 2.1
- [ ] New sub-agents can follow PATTERNS.md to add a new entity without referencing Sprint 1-6 docs

---

## 12. Cross-References

| Topic | Document | Section |
|-------|----------|---------|
| Rate limiting spec | `docs/API_DESIGN.md` | 12. Rate Limiting |
| Complexity calculation | `docs/API_DESIGN.md` | 12 (Complexity) |
| Component hierarchy | `docs/ARCHITECTURE.md` | 4.1 (all components) |
| Dark mode requirement | `docs/PRD.md` | UX (dark/light mode) |
| Performance targets | `docs/PRD.md` | <100ms interactions, <50ms sync |
| Infrastructure | `docs/ARCHITECTURE.md` | 7. Deployment Architecture |
| Monitoring stack | `docs/ARCHITECTURE.md` | 2.3 Infrastructure (Sentry, Prometheus) |

---

## 13. Alpha Release Checklist

Upon completion of this sprint, the following should be true for the **Alpha milestone (Week 12)**:

- [ ] Auth: email magic link + Google OAuth fully working
- [ ] Teams: create, configure, manage members
- [ ] Workflow states: customizable per team, constraints enforced
- [ ] Issues: full CRUD with identifiers, all properties, labels
- [ ] List view: virtualized, grouped, inline editing, keyboard navigation
- [ ] Sync engine: local-first, optimistic updates, real-time WebSocket, offline support
- [ ] Search: full-text, ID jump, fuzzy matching
- [ ] Command palette: Cmd+K with actions and navigation
- [ ] Keyboard shortcuts: full shortcut system
- [ ] Dark mode: light/dark/system
- [ ] Performance: 60fps scrolling, <5s bootstrap
- [ ] Testing: E2E coverage for critical paths
- [ ] Observability: error tracking, structured logging
- [ ] Rate limiting: enforced with correct headers
- [ ] Pattern documentation: PATTERNS.md for Phase 2 onboarding
