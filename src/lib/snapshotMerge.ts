export const DEFAULT_SEED_USER_IDS = new Set([
  'user_admin1',
  'user_superadmin_saeful',
  'user_circle_assistant',
]);

export function getItemId(item: any, altKey?: string): string {
  if (!item || typeof item !== 'object') return '';
  const raw =
    item.id ??
    (altKey ? item[altKey] : undefined) ??
    item.task_id ??
    item.board_id ??
    item.post_id ??
    item.note_id ??
    item.user_id;
  return raw ? String(raw).trim() : '';
}

export function mergeItemsById(existingList: any[], incomingList: any[], altKey?: string): any[] {
  const out = Array.isArray(existingList) ? [...existingList] : [];
  const idxMap = new Map<string, number>();
  out.forEach((it, idx) => {
    const id = getItemId(it, altKey);
    if (id) idxMap.set(id, idx);
  });

  for (const inc of Array.isArray(incomingList) ? incomingList : []) {
    const id = getItemId(inc, altKey);
    if (!id) continue;
    const normalized = !inc.id && altKey !== 'user_id' ? { ...inc, id } : inc;
    const existingIdx = idxMap.get(id);
    if (existingIdx === undefined) {
      idxMap.set(id, out.length);
      out.push(normalized);
    } else {
      const cur = out[existingIdx];
      const curTime = new Date(cur?.updated_at || cur?.created_at || 0).getTime();
      const incTime = new Date(normalized?.updated_at || normalized?.created_at || 0).getTime();
      if (incTime > curTime) {
        out[existingIdx] = { ...cur, ...normalized };
      } else {
        // Fill any missing non-empty sub-arrays (comments/attachments) if current has fewer
        if (
          altKey === 'task_id' &&
          Array.isArray(normalized?.comments) &&
          normalized.comments.length > (Array.isArray(cur?.comments) ? cur.comments.length : 0)
        ) {
          out[existingIdx] = {
            ...out[existingIdx],
            comments: mergeItemsById(cur?.comments || [], normalized.comments),
          };
        }
      }
    }
  }
  return out;
}

export function computePayloadSummary(payload: any): Record<string, number> {
  const d = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const uploads = payload?.uploaded_files_base64 || {};
  return {
    users: Array.isArray(d.users)
      ? d.users.filter((u: any) => !u?.is_bot && u?.role !== 'assistant').length
      : 0,
    tasks: Array.isArray(d.tasks) ? d.tasks.length : 0,
    projects: Array.isArray(d.projects) ? d.projects.length : 0,
    boards: Array.isArray(d.boards) ? d.boards.length : 0,
    conversations: Array.isArray(d.conversations) ? d.conversations.length : 0,
    groups: Array.isArray(d.groups) ? d.groups.length : 0,
    messages: Array.isArray(d.messages) ? d.messages.length : 0,
    posts: Array.isArray(d.posts) ? d.posts.length : 0,
    org_units: Array.isArray(d.org_units) ? d.org_units.length : 0,
    polls: Array.isArray(d.polls) ? d.polls.length : 0,
    circle_notes: Array.isArray(d.circle_notes) ? d.circle_notes.length : 0,
    stickers: Array.isArray(d.stickers) ? d.stickers.length : 0,
    upload_files: uploads && typeof uploads === 'object' ? Object.keys(uploads).length : 0,
  };
}

export function hasMeaningfulWorkspaceData(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const d = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const humanUsers = Array.isArray(d.users)
    ? d.users.filter((u: any) => !u?.is_bot && u?.role !== 'assistant')
    : [];
  const hasCustomUser = humanUsers.some((u: any) => u?.user_id && !DEFAULT_SEED_USER_IDS.has(u.user_id));
  const usersCount = humanUsers.length;
  const tasksCount = Array.isArray(d.tasks) ? d.tasks.length : 0;
  const msgsCount = Array.isArray(d.messages) ? d.messages.length : 0;
  const postsCount = Array.isArray(d.posts) ? d.posts.length : 0;
  const notesCount = Array.isArray(d.circle_notes) ? d.circle_notes.length : 0;
  const ordersCount = Array.isArray(d.marketplace_orders) ? d.marketplace_orders.length : 0;
  const listingsCount = Array.isArray(d.marketplace_listings) ? d.marketplace_listings.length : 0;
  const accessReqCount = Array.isArray(d.access_requests) ? d.access_requests.length : 0;
  const templatesCount = Array.isArray(d.workspace?.checkpoint_templates)
    ? d.workspace.checkpoint_templates.length
    : 0;
  return (
    hasCustomUser ||
    usersCount > 2 ||
    tasksCount > 0 ||
    msgsCount > 0 ||
    postsCount > 1 ||
    notesCount > 0 ||
    ordersCount > 0 ||
    listingsCount > 4 ||
    accessReqCount > 0 ||
    templatesCount > 0
  );
}

export function mergeTwoSnapshotsNonDestructive(primarySnap: any, secondarySnap: any): any {
  if (!primarySnap) return secondarySnap;
  if (!secondarySnap) return primarySnap;
  const clone = JSON.parse(JSON.stringify(primarySnap));
  const pRoot = clone.data && typeof clone.data === 'object' ? clone.data : clone;
  const sRoot =
    secondarySnap.data && typeof secondarySnap.data === 'object'
      ? secondarySnap.data
      : secondarySnap;

  pRoot.users = mergeItemsById(pRoot.users || [], sRoot.users || [], 'user_id');
  pRoot.tasks = mergeItemsById(pRoot.tasks || [], sRoot.tasks || [], 'task_id');
  pRoot.boards = mergeItemsById(pRoot.boards || [], sRoot.boards || [], 'board_id');
  pRoot.messages = mergeItemsById(pRoot.messages || [], sRoot.messages || []);
  pRoot.conversations = mergeItemsById(pRoot.conversations || [], sRoot.conversations || []);
  pRoot.groups = mergeItemsById(pRoot.groups || [], sRoot.groups || []);
  pRoot.posts = mergeItemsById(pRoot.posts || [], sRoot.posts || [], 'post_id');
  pRoot.circle_notes = mergeItemsById(pRoot.circle_notes || [], sRoot.circle_notes || [], 'note_id');
  pRoot.meetings = mergeItemsById(pRoot.meetings || [], sRoot.meetings || []);
  pRoot.projects = mergeItemsById(pRoot.projects || [], sRoot.projects || []);
  pRoot.org_units = mergeItemsById(pRoot.org_units || [], sRoot.org_units || []);
  pRoot.drive_shortcuts = mergeItemsById(pRoot.drive_shortcuts || [], sRoot.drive_shortcuts || []);
  pRoot.labels = mergeItemsById(pRoot.labels || [], sRoot.labels || []);
  pRoot.notifications = mergeItemsById(pRoot.notifications || [], sRoot.notifications || []);
  pRoot.activity = mergeItemsById(pRoot.activity || [], sRoot.activity || []);
  pRoot.reminders = mergeItemsById(pRoot.reminders || [], sRoot.reminders || []);
  pRoot.polls = mergeItemsById(pRoot.polls || [], sRoot.polls || []);
  pRoot.task_automations = mergeItemsById(pRoot.task_automations || [], sRoot.task_automations || []);
  pRoot.invitations = mergeItemsById(pRoot.invitations || [], sRoot.invitations || []);
  pRoot.access_requests = mergeItemsById(pRoot.access_requests || [], sRoot.access_requests || []);
  pRoot.sticker_packs = mergeItemsById(pRoot.sticker_packs || [], sRoot.sticker_packs || []);
  pRoot.stickers = mergeItemsById(pRoot.stickers || [], sRoot.stickers || []);

  if (sRoot.workspace?.checkpoint_templates || pRoot.workspace?.checkpoint_templates) {
    pRoot.workspace = pRoot.workspace && typeof pRoot.workspace === 'object' ? pRoot.workspace : {};
    pRoot.workspace.checkpoint_templates = mergeItemsById(
      pRoot.workspace.checkpoint_templates || [],
      sRoot.workspace?.checkpoint_templates || []
    );
  }
  if (Array.isArray(sRoot.workspace?.divisions) && sRoot.workspace.divisions.length > 0) {
    pRoot.workspace = pRoot.workspace && typeof pRoot.workspace === 'object' ? pRoot.workspace : {};
    const existingDivs = Array.isArray(pRoot.workspace.divisions) ? pRoot.workspace.divisions : [];
    pRoot.workspace.divisions = Array.from(new Set([...existingDivs, ...sRoot.workspace.divisions]));
  }

  if (secondarySnap.uploaded_files_base64 && typeof secondarySnap.uploaded_files_base64 === 'object') {
    clone.uploaded_files_base64 = {
      ...secondarySnap.uploaded_files_base64,
      ...(clone.uploaded_files_base64 || {}),
    };
  }

  const pRev = Number(clone.revision ?? pRoot.revision ?? 0);
  const sRev = Number(secondarySnap.revision ?? sRoot.revision ?? 0);
  clone.revision = Math.max(pRev, sRev);
  clone.summary = computePayloadSummary(clone);
  return clone;
}
