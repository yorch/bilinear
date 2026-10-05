'use client';

import { Check, Copy } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomFieldsEditor } from '@/components/custom-fields/custom-fields-editor';
import { TipTapEditor } from '@/components/editor/tiptap-editor.lazy';
import { AssigneeSelect } from '@/components/properties/assignee-select';
import { CycleSelect } from '@/components/properties/cycle-select';
import { DueDatePicker } from '@/components/properties/due-date-picker';
import { EstimatePicker } from '@/components/properties/estimate-picker';
import { LabelDot, LabelSelect } from '@/components/properties/label-select';
import { MilestoneSelect } from '@/components/properties/milestone-select';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { PrioritySelect } from '@/components/properties/priority-select';
import { ProjectSelect } from '@/components/properties/project-select';
import { StatusSelect } from '@/components/properties/status-select';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { getCycleDisplayName } from '@/lib/cycle-utils';
import { getBranchName, getDueDateColor } from '@/lib/issue-utils';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { ActivityTimeline } from './activity-timeline';
import { AiInsights } from './ai-insights';
import { CommentThread } from './comment-thread';
import { FileAttachments } from './file-attachments';
import { IssueReactionBar } from './issue-reaction-bar';
import { PullRequestsSection } from './pull-requests-section';
import { RelationsSection } from './relations-section';
import { isIssueSnoozed } from './snooze-presets';
import { SubIssueList } from './sub-issue-list';

/**
 * Where the content is rendered.
 *
 * `page` — the `/issue/[id]` route: a centred column with the properties in a
 * right-hand rail, which is what a *destination* for an issue should look like.
 * `panel` — the overlay opened from a list: one narrow column, because 480px
 * cannot carry two.
 *
 * Both share this component. The route used to mount the overlay panel itself,
 * so navigating to an issue URL produced a 480px sheet floating over an empty
 * canvas with two thirds of the window blank.
 */
export type IssueDetailLayout = 'page' | 'panel';

export interface IssueDetailContentProps {
  issue: IssueDetail;
  labels: IssueLabel[];
  layout: IssueDetailLayout;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  states: WorkflowState[];
  users: IssueUser[];
}

type DiscussionTab = 'comments' | 'activity';

/**
 * Title, properties, description and every issue subsection, laid out for
 * either the full page or the overlay panel.
 */
export const IssueDetailContent = observer(function IssueDetailContent({
  issue,
  states,
  users,
  labels,
  layout,
  onUpdate,
}: IssueDetailContentProps) {
  const t = useTranslations();
  const { formatDueDate, formatDate } = useFormatters();
  const { userStore, teamStore, issueStore, cycleStore } = useStore();
  const currentUserId = userStore.currentUser?.id;
  const currentUserName = userStore.currentUser?.displayName ?? t('issueDetail.defaultUserName');
  const mentionUsers = useMemo(() => users.map(u => ({ id: u.id, label: u.displayName })), [users]);
  // observer() tracks issueStore.all reads reactively; plain map is correct here.
  const mentionIssues = issueStore.all.map(i => ({ id: i.id, label: i.identifier, sub: i.title }));
  // Resolve estimation type from team so the correct scale displays
  const estimationType = teamStore.findById(issue.teamId)?.issueEstimationType ?? 'notUsed';

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [activityKey, setActivityKey] = useState(0);
  const [branchCopied, setBranchCopied] = useState(false);
  const [tab, setTab] = useState<DiscussionTab>('comments');
  const titleRef = useRef<HTMLInputElement>(null);

  const handleUpdate = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      onUpdate(id, patch);
      setActivityKey(k => k + 1);
    },
    [onUpdate],
  );

  // Tracks the previously-rendered issue id so the effect below can tell an
  // actual issue switch apart from an in-place field update on the same
  // issue (e.g. a collaborator's edit arriving over WS).
  const prevIssueIdRef = useRef<string | null>(null);

  // Reset title/description drafts when switching issues, and refresh
  // whichever draft the user ISN'T actively editing when the same issue's
  // title/description changes underneath us (e.g. a collaborator's edit).
  // Two failure modes this balances:
  //  - Resetting on every render of the `issue` object (rebuilt on every
  //    pool change since callers pass a literal / observer() re-renders on
  //    any store change) would wipe in-progress typing on every unrelated
  //    property change — the original bug, fixed by keying off `issue.id`.
  //  - But keying ONLY off `issue.id` means a collaborator's incoming
  //    title/description change while the panel stays open on the same
  //    issue never refreshes the draft: clicking to edit later shows a
  //    stale value, and blurring can stomp the collaborator's change right
  //    back (`saveTitle`/`saveDesc` compare the stale draft against
  //    `issue.title`/`issue.description` and "helpfully" re-save it).
  // Switching issues (by id) always resets both drafts and collapses the
  // description editor, regardless of any in-flight edit for the issue
  // being left, so the collab provider remounts for the new document room.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally excludes editingTitle/editingDesc — see comment above; only their freshest value at the moment id/title/description change matters, not a re-run when they toggle on their own
  useEffect(() => {
    const switchedIssue = prevIssueIdRef.current !== issue.id;
    prevIssueIdRef.current = issue.id;

    if (switchedIssue || !editingTitle) {
      setTitleDraft(issue.title);
    }
    if (switchedIssue) {
      // Collapse the description editor when switching issues so the collab
      // provider is remounted for the correct document room.
      setEditingDesc(false);
    }
    if (switchedIssue || !editingDesc) {
      setDescDraft(issue.description ?? '');
    }
  }, [issue.id, issue.title, issue.description]);

  const assignee = users.find(u => u.id === issue.assigneeId);
  const dueDateColor = getDueDateColor(issue.dueDate);
  const currentCycle = issue.cycleId ? cycleStore.findById(issue.cycleId) : null;
  const isPage = layout === 'page';
  // `IssueDetail` is the narrow list-row shape; the fields only the detail view
  // shows (milestone, branch) come straight off the store row.
  const storeRow = issueStore.findById(issue.id);
  const snoozedUntilAt = storeRow?.snoozedUntilAt ?? null;
  const branchName = storeRow?.branchName ?? getBranchName(issue.identifier, issue.title);

  const copyBranchName = () => {
    navigator.clipboard
      .writeText(branchName)
      .then(() => {
        setBranchCopied(true);
        setTimeout(() => setBranchCopied(false), 1500);
      })
      .catch(() => toast.error(t('issueDetail.properties.copyFailed')));
  };

  const saveTitle = () => {
    if (titleDraft.trim() && titleDraft.trim() !== issue.title) {
      handleUpdate(issue.id, { title: titleDraft.trim() });
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    if (descDraft !== (issue.description ?? '')) {
      handleUpdate(issue.id, { description: descDraft || null });
    }
    setEditingDesc(false);
  };

  const title = editingTitle ? (
    <input
      className={cn(
        'w-full bg-transparent font-semibold tracking-tight text-foreground outline-none',
        isPage ? 'text-2xl' : 'text-xl',
      )}
      onBlur={saveTitle}
      onChange={e => setTitleDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          saveTitle();
        }
        if (e.key === 'Escape') {
          setTitleDraft(issue.title);
          setEditingTitle(false);
        }
      }}
      ref={titleRef}
      type="text"
      value={titleDraft}
    />
  ) : (
    <button
      className={cn(
        'cursor-text text-left font-semibold leading-snug tracking-tight text-foreground',
        isPage ? 'text-2xl' : 'text-xl',
      )}
      onClick={() => {
        setEditingTitle(true);
        setTimeout(() => titleRef.current?.focus(), 20);
      }}
      type="button"
    >
      {issue.title}
    </button>
  );

  const snoozedBadge = isIssueSnoozed(snoozedUntilAt) ? (
    <div>
      <Badge
        data-testid="issue-snoozed-badge"
        title={t('issues.snooze.snoozedUntil', { date: formatDate(snoozedUntilAt ?? '') })}
        tone="muted"
      >
        {t('issues.snooze.snoozedBadge')}
      </Badge>
    </div>
  ) : null;

  const properties = (
    <div
      className={cn(
        'grid grid-cols-[auto_1fr] items-center gap-x-4 text-sm',
        isPage ? 'gap-y-3' : 'gap-y-2',
      )}
    >
      <span className="text-muted-foreground">{t('issueDetail.properties.status')}</span>
      <StatusSelect
        onChange={stateId => handleUpdate(issue.id, { stateId })}
        states={states}
        value={issue.stateId}
      />

      <span className="text-muted-foreground">{t('issueDetail.properties.priority')}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <PrioritySelect
          onChange={priority => handleUpdate(issue.id, { priority })}
          value={issue.priority}
        />
        <span className="truncate text-xs text-muted-foreground">
          {t(priorityLabelKey(issue.priority))}
        </span>
      </div>

      <span className="text-muted-foreground">{t('issueDetail.properties.assignee')}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <AssigneeSelect
          onChange={assigneeId => handleUpdate(issue.id, { assigneeId })}
          users={users}
          value={issue.assigneeId}
        />
        <span className="truncate text-xs text-muted-foreground">
          {assignee?.displayName ?? t('issueDetail.properties.noAssignee')}
        </span>
      </div>

      <span className="text-muted-foreground">{t('issueDetail.properties.labels')}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <LabelSelect
          labels={labels}
          onChange={labelIds => handleUpdate(issue.id, { labelIds })}
          value={issue.labels.map(l => l.id)}
        />
        {issue.labels.map(l => (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" key={l.id}>
            <LabelDot color={l.color} />
            {l.name}
          </span>
        ))}
      </div>

      <span className="text-muted-foreground">{t('issueDetail.properties.project')}</span>
      <ProjectSelect
        onChange={projectId =>
          // A milestone belongs to its project, so moving projects clears it.
          handleUpdate(issue.id, { projectId, projectMilestoneId: null })
        }
        value={issue.projectId ?? null}
      />

      {/* Milestone — only meaningful once the issue is in a project */}
      {issue.projectId && (
        <>
          <span className="text-muted-foreground">{t('issueDetail.properties.milestone')}</span>
          <MilestoneSelect
            onChange={projectMilestoneId => handleUpdate(issue.id, { projectMilestoneId })}
            projectId={issue.projectId}
            value={storeRow?.projectMilestoneId ?? null}
          />
        </>
      )}

      <span className="text-muted-foreground">{t('issueDetail.properties.cycle')}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <CycleSelect
          onChange={cycleId => handleUpdate(issue.id, { cycleId })}
          teamId={issue.teamId}
          value={issue.cycleId ?? null}
        />
        {currentCycle && (
          <span className="truncate text-xs text-muted-foreground">
            {getCycleDisplayName(currentCycle)}
          </span>
        )}
      </div>

      <span className="text-muted-foreground">{t('issueDetail.properties.startDate')}</span>
      <DueDatePicker
        onChange={startDate => handleUpdate(issue.id, { startDate })}
        value={issue.startDate}
      />

      <span className="text-muted-foreground">{t('issueDetail.properties.dueDate')}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <DueDatePicker
          onChange={dueDate => handleUpdate(issue.id, { dueDate })}
          value={issue.dueDate}
        />
        {issue.dueDate && (
          <span className={cn('truncate text-xs', dueDateColor)}>
            {formatDueDate(issue.dueDate)}
          </span>
        )}
      </div>

      {/* Estimate — only shown when the team uses estimation */}
      {estimationType !== 'notUsed' && (
        <>
          <span className="text-muted-foreground">{t('issueDetail.properties.estimate')}</span>
          <EstimatePicker
            estimationType={estimationType}
            onChange={estimate => handleUpdate(issue.id, { estimate: estimate ?? undefined })}
            value={issue.estimate}
          />
        </>
      )}

      {/* Branch name — derived until the server assigns one */}
      <span className="text-muted-foreground">{t('issueDetail.properties.branch')}</span>
      <div className="flex min-w-0 items-center gap-1">
        <code
          className="min-w-0 truncate font-mono text-xs text-foreground-secondary"
          data-testid="issue-branch-name"
          title={branchName}
        >
          {branchName}
        </code>
        <button
          aria-label={t('issues.copyBranchName')}
          className={cn(
            'shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground',
            TOUCH_TARGET,
          )}
          onClick={copyBranchName}
          title={t('issues.copyBranchName')}
          type="button"
        >
          {branchCopied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );

  const description = (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        {t('issueDetail.description')}
      </p>
      {editingDesc ? (
        <div className="rounded-md border border-brand bg-transparent p-2 transition-colors">
          <TipTapEditor
            className="text-sm"
            collabDocId={`issue:${issue.id}`}
            collabUserName={currentUserName}
            content={descDraft}
            mentionIssues={mentionIssues}
            mentionUsers={mentionUsers}
            onBlur={saveDesc}
            onChange={html => setDescDraft(html)}
            placeholder={t('issueDetail.descriptionPlaceholderFull')}
            readOnly={false}
            showToolbar={true}
            uploadIssueId={issue.id}
          />
        </div>
      ) : (
        <button
          className="w-full cursor-text rounded-md p-2 text-left transition-colors hover:bg-accent/50"
          onClick={() => setEditingDesc(true)}
          type="button"
        >
          {/* An issue with no description used to render a blank clickable box:
              the read-only editor does not run the Placeholder extension, so
              there was nothing to say the area was writable. */}
          {isEmptyRichText(descDraft) ? (
            <span className="text-sm text-muted-foreground">
              {t('issueDetail.descriptionPlaceholder')}
            </span>
          ) : (
            <TipTapEditor
              className="text-sm"
              content={descDraft}
              onBlur={saveDesc}
              onChange={html => setDescDraft(html)}
              readOnly={true}
              showToolbar={false}
            />
          )}
        </button>
      )}
    </div>
  );

  /**
   * Comments and Activity as tabs rather than two stacked sections.
   *
   * Activity was the last section of a long scroll, so it was effectively
   * invisible; and both carried their own hand-rolled heading, adding two more
   * header treatments to a screen that already had four.
   */
  const discussion = (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <SegmentedControl
          onChange={setTab}
          options={[
            { label: t('issueDetail.comments.title'), value: 'comments' },
            { label: t('issueDetail.activity.title'), value: 'activity' },
          ]}
          value={tab}
        />
      </div>
      {tab === 'comments' ? (
        <CommentThread
          currentUserId={currentUserId}
          issueId={issue.id}
          mentionIssues={mentionIssues}
          mentionUsers={mentionUsers}
          teamId={issue.teamId}
        />
      ) : (
        <ActivityTimeline issueId={issue.id} refetchKey={activityKey} />
      )}
    </div>
  );

  const sections = (
    <>
      <IssueReactionBar currentUserId={currentUserId} issueId={issue.id} />
      <AiInsights issueId={issue.id} />
      <SubIssueList parentIssueId={issue.id} />
      <RelationsSection issueId={issue.id} />
      <PullRequestsSection issueId={issue.id} />
      <FileAttachments issueId={issue.id} />
      {discussion}
    </>
  );

  if (isPage) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-8 lg:flex-row lg:gap-12">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {title}
          {snoozedBadge}
          {description}
          {sections}
        </div>
        {/* Sticky so the properties stay reachable while reading a long
            description or comment thread — the panel had to scroll them away. */}
        <aside className="w-full shrink-0 lg:sticky lg:top-8 lg:w-72 lg:self-start">
          <div className="flex flex-col gap-6">
            {properties}
            <CustomFieldsEditor issueId={issue.id} teamId={issue.teamId} />
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      {title}
      {snoozedBadge}
      {properties}
      <CustomFieldsEditor issueId={issue.id} teamId={issue.teamId} />
      {description}
      {sections}
    </div>
  );
});

/**
 * Whether a TipTap HTML value carries no visible content.
 *
 * TipTap serialises an empty document as `<p></p>`, so `!html` alone reports a
 * description as present when it is not.
 */
function isEmptyRichText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').trim() === '';
}
