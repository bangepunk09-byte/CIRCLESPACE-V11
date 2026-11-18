import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  profile: Record<string, any> = {}
) {
  try {
    const cleanEmail = String(email || '').toLowerCase().trim();
    const resolvedUserId = String(profile.user_id || uid);
    const resolvedName = String(profile.name || cleanEmail.split('@')[0] || 'User').trim();
    const mergedProfile: Record<string, any> = {
      user_id: resolvedUserId,
      firebase_uid: uid,
      email: cleanEmail,
      name: resolvedName,
      role: profile.role || 'employee',
      department: profile.department || 'Marketing',
      job_title: profile.job_title || 'Staff Member',
      status: profile.status || 'active',
      ...profile,
    };

    const result = await db
      .insert(users)
      .values({
        uid,
        userId: resolvedUserId,
        email: cleanEmail,
        name: resolvedName,
        role: mergedProfile.role,
        department: mergedProfile.department,
        jobTitle: mergedProfile.job_title,
        status: mergedProfile.status,
        avatar: mergedProfile.avatar || mergedProfile.picture || null,
        profileData: mergedProfile,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: cleanEmail,
          name: resolvedName,
          role: mergedProfile.role,
          department: mergedProfile.department,
          jobTitle: mergedProfile.job_title,
          status: mergedProfile.status,
          avatar: mergedProfile.avatar || mergedProfile.picture || null,
          profileData: mergedProfile,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error('Database query failed in getUserByUid:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}
