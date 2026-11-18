# Firestore Security Specification — CIRCLE Workspace Backup & Live Sync

## 1. Data Invariants
1. **Default-Deny Baseline**: Every unspecified document path is strictly denied (`allow read, write: if false`).
2. **Verified Identity**: Only authenticated users with `request.auth.token.email_verified == true` may read or write backup snapshots.
3. **Strict Ownership, Admin & Verified Team Domain Scope**:
   - Every `/workspaceBackups/{backupId}` document MUST bind `ownerUid == request.auth.uid` on creation and preserve `ownerUid` and `createdAt` immutably on update.
   - Personal backups (`live_sync_{uid}`, `bk_*`, `hourly_*_{uid8}`) are readable/writable only by their owner (`existing().ownerUid == request.auth.uid`) or verified admins (`isAdmin()`).
   - Shared team live sync (`shared_workspace_live`) and shared hourly rolling snapshots (`hourly_YYYYMMDD_HH_shared`) can only be created, read, or updated by verified admins (`isAdmin()`) or verified team domain members (`@asliri.id` with `email_verified == true`), and CANNOT be deleted by non-admin members.
4. **Master Gate on Chunks**: Every `/workspaceBackups/{backupId}/chunks/{chunkId}` operation verifies parent backup existence (`exists(...)`) and authorization (`parent.ownerUid == request.auth.uid`, shared team scope on `shared_workspace_live` / `hourly_*_shared`, or `isAdmin()`), validates `incoming().backupId == backupId`, `incoming().ownerUid == request.auth.uid` on create, and preserves immutable `ownerUid`, `backupId`, `createdAt` on update.
5. **No JSON Strings / Native Maps & Lists**: Chunks store native Firestore maps (`payload is map`) and lists without `JSON.stringify`.
6. **Temporal Integrity**: `createdAt == request.time` on create; `updatedAt == request.time` on create and update.

## 2. "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write**: `request.auth == null` on `/workspaceBackups/shared_workspace_live`.
2. **Unverified email spoofing**: `request.auth.token.email == 'saeful@asliri.id'` with `request.auth.token.email_verified == false`.
3. **Non-team external user squatting shared backup**: Verified external user (`attacker@gmail.com`, `email_verified: true`) attempting to create or update `/workspaceBackups/shared_workspace_live`.
4. **Identity spoofing on create**: `ownerUid: 'other_user_uid'` when `request.auth.uid == 'attacker_uid'`.
5. **Shadow/ghost field injection on create**: Extra key `isAdmin: true` in `/workspaceBackups/bk_1` (`keys().hasOnly(...)` rejects).
6. **Shadow/ghost field injection on update**: Non-admin team member updating `ownerUid`, `ownerEmail`, or `createdAt` on `shared_workspace_live`.
7. **Oversized document ID poisoning**: `backupId` with 200 characters or invalid symbols (`../bad$id`).
8. **Oversized string poisoning**: `workspaceName` > 120 chars or `label` > 120 chars.
9. **Invalid section enum on chunk**: `section: 'arbitrary_exec'` not in allowlist.
10. **Orphaned chunk / cross-tenant chunk injection**: Writing to `/workspaceBackups/victim_backup/chunks/c_1` where parent `ownerUid != request.auth.uid` and `backupId` is not shared.
11. **Client-forged timestamp**: `createdAt: '2026-01-01T00:00:00Z'` instead of `request.time`.
12. **Privilege escalation & destructive shared delete**: Non-admin attempting to create `/admins/$(request.auth.uid)` or delete `/workspaceBackups/shared_workspace_live`.
