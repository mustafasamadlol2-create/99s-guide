import { getPrisma } from "./prismaClient.js";
import crypto from "node:crypto";

/**
 * Public user record — deliberately excludes password_hash, reset_token, and
 * reset_token_expires.  Those fields are managed exclusively through the
 * dedicated methods below (getPasswordHash, storeResetToken, etc.) so they
 * can never be accidentally serialised into an API response.
 */
export interface UserRecord {
  id: string;
  email: string;
  profileEmail?: string | null;
  role: "admin" | "user" | "owner";
  sessionVersion?: number;
  name?: string;
  avatar?: string;
  avatarUrl?: string;
  signature?: string | null;
  totalPoints?: number;
  level?: string;
  levelBadge?: string;
  streakDays?: number;
  totalTimeSpent?: number;
  lastActive?: string;
  created_at?: string;
  studentGroup?: string;
  accountStatus?: 'active' | 'banned' | 'pending' | 'pending_profile';
  isPrimaryOwner?: boolean;
  emailVerified?: boolean;
  isOnline?: boolean;
}

/** Input type for createUser — includes the password hash that must never appear in UserRecord. */
interface CreateUserInput {
  id: string;
  email: string;
  passwordHash?: string | null;
  role?: "admin" | "user" | "owner";
  name?: string;
  avatar?: string | null;
  avatarUrl?: string;
  signature?: string;
  totalPoints?: number;
  level?: string;
  levelBadge?: string;
  streakDays?: number;
  totalTimeSpent?: number;
  lastActive?: string;
  created_at?: string;
  studentGroup?: string;
  accountStatus?: 'active' | 'banned' | 'pending' | 'pending_profile';
  emailVerified?: boolean;
  isOnline?: boolean;
}

interface ProgressRecord {
  userId: string;
  lectureId: string;
  pdfCompleted: boolean;
  notesCompleted: boolean;
  videoCompleted: boolean;
  flashcardsCompleted: boolean;
  quizCompleted: boolean;
  quizScore: number;
  lastAccessed: string;
}

interface PointsLogRecord {
  id: string;
  userId: string;
  points: number;
  reason: string;
  createdAt: string;
}

interface CalendarEventRecord {
  id: string;
  userId: string;
  title: string;
  date: string;
  type?: string;
  completed: boolean;
}

export class UserService {
  // Callbacks for real-time socket events
  static onUpdate?: (user: any) => void;
  static onCreate?: (user: any) => void;
  static onDelete?: (userId: string) => void;

  // Find user by email
  static async findByEmail(email: string): Promise<UserRecord | null> {
    const client = getPrisma();
    const cleanEmail = email.trim().toLowerCase();
    try {
      const u = await client.user.findUnique({
        where: { email: cleanEmail },
        select: {
          id: true, email: true, profileEmail: true, role: true, sessionVersion: true,
          name: true, avatar: true, avatarUrl: true, signature: true, totalPoints: true,
          level: true, levelBadge: true, streakDays: true, totalTimeSpent: true,
          lastActive: true, createdAt: true, accountStatus: true,
          isOnline: true, studentGroup: true, isPrimaryOwner: true,
          emailVerified: true,
        },
      });
      if (!u) return null;

      return {
        id: u.id,
        email: u.email,
        profileEmail: u.profileEmail ?? null,
        role: (u.role === "admin" || u.role === "owner" ? u.role : "user") as "admin" | "user" | "owner",
        sessionVersion: u.sessionVersion,
        name: u.name || "",
        avatar: u.avatar || "",
        avatarUrl: u.avatarUrl || u.avatar || "",
        signature: u.signature,
        totalPoints: u.totalPoints,
        level: u.level,
        levelBadge: u.levelBadge,
        streakDays: u.streakDays,
        totalTimeSpent: u.totalTimeSpent,
        lastActive: u.lastActive ? u.lastActive.toISOString() : new Date().toISOString(),
        created_at: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
        accountStatus: u.accountStatus && u.accountStatus.toLowerCase() === "banned" ? "banned" : u.accountStatus === "PENDING_PROFILE" ? "pending_profile" : u.accountStatus === "PENDING" ? "pending" : "active",
        isPrimaryOwner: u.isPrimaryOwner === true,
        emailVerified: u.emailVerified !== false,
        isOnline: u.isOnline,
        studentGroup: u.studentGroup || "A",
      };
    } catch (err) {
      console.error("findByEmail error:", err);
      // Do not turn a database outage into "user not found". Authentication
      // middleware must be able to return a retryable infrastructure error.
      throw err;
    }
  }

  // Find user by ID
  static async findById(id: string): Promise<UserRecord | null> {
    const client = getPrisma();
    try {
      const u = await client.user.findUnique({
        where: { id },
        select: {
          id: true, email: true, profileEmail: true, role: true, sessionVersion: true,
          name: true, avatar: true, avatarUrl: true, signature: true, totalPoints: true,
          level: true, levelBadge: true, streakDays: true, totalTimeSpent: true,
          lastActive: true, createdAt: true, accountStatus: true,
          isOnline: true, studentGroup: true, isPrimaryOwner: true,
          emailVerified: true,
        },
      });
      if (!u) return null;

      return {
        id: u.id,
        email: u.email,
        profileEmail: u.profileEmail ?? null,
        role: (u.role === "admin" || u.role === "owner" ? u.role : "user") as "admin" | "user" | "owner",
        sessionVersion: u.sessionVersion,
        name: u.name || "",
        avatar: u.avatar || "",
        avatarUrl: u.avatarUrl || u.avatar || "",
        signature: u.signature,
        totalPoints: u.totalPoints,
        level: u.level,
        levelBadge: u.levelBadge,
        streakDays: u.streakDays,
        totalTimeSpent: u.totalTimeSpent,
        lastActive: u.lastActive ? u.lastActive.toISOString() : new Date().toISOString(),
        created_at: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
        accountStatus: u.accountStatus && u.accountStatus.toLowerCase() === "banned" ? "banned" : u.accountStatus === "PENDING_PROFILE" ? "pending_profile" : u.accountStatus === "PENDING" ? "pending" : "active",
        isPrimaryOwner: u.isPrimaryOwner === true,
        emailVerified: u.emailVerified !== false,
        isOnline: u.isOnline,
        studentGroup: u.studentGroup || "A",
      };
    } catch (err) {
      console.error("findById error:", err);
      // A failed lookup is not proof that the account was deleted.
      throw err;
    }
  }

  // Create new user (expects passwordHash already hashed by AuthService)
  static async createUser(user: CreateUserInput): Promise<UserRecord> {
    const client = getPrisma();
    const cleanEmail = user.email.trim().toLowerCase();
    
    const u = await client.user.create({
      data: {
        id: user.id,
        email: cleanEmail,
        passwordHash: user.passwordHash ?? null,
        role: user.role || "user",
        name: user.name || cleanEmail.split("@")[0],
        avatar: user.avatarUrl || user.avatar || "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=150&q=80",
        avatarUrl: user.avatarUrl || user.avatar || "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=150&q=80",
        signature: user.signature || "",
        totalPoints: user.totalPoints || 0,
        level: user.level || "Rising (Resident) 🔬",
        levelBadge: user.levelBadge || "Lvl 1",
        streakDays: user.streakDays || 0,
        totalTimeSpent: user.totalTimeSpent || 0,
        lastActive: user.lastActive ? new Date(user.lastActive) : new Date(),
        createdAt: user.created_at ? new Date(user.created_at) : new Date(),
        accountStatus: user.accountStatus === "banned" ? "BANNED" : user.accountStatus === "pending_profile" ? "PENDING_PROFILE" : user.accountStatus === "pending" ? "PENDING" : "ACTIVE",
        emailVerified: user.emailVerified !== false,
        isOnline: user.isOnline || false,
        studentGroup: user.studentGroup || "A"
      }
    });

    const createdUserRecord = {
      id: u.id,
      email: u.email,
      profileEmail: u.profileEmail ?? null,
      role: (u.role === "admin" || u.role === "owner" ? u.role : "user") as "admin" | "user" | "owner",
      sessionVersion: u.sessionVersion,
      name: u.name || "",
      avatar: u.avatar || "",
      avatarUrl: u.avatarUrl || u.avatar || "",
      signature: u.signature || "",
      totalPoints: u.totalPoints,
      level: u.level,
      levelBadge: u.levelBadge,
      streakDays: u.streakDays,
      totalTimeSpent: u.totalTimeSpent,
      lastActive: u.lastActive ? u.lastActive.toISOString() : new Date().toISOString(),
      created_at: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
      accountStatus: (u.accountStatus && u.accountStatus.toLowerCase() === "banned" ? "banned" : u.accountStatus === "PENDING_PROFILE" ? "pending_profile" : u.accountStatus === "PENDING" ? "pending" : "active") as "active" | "banned" | "pending" | "pending_profile",
      isPrimaryOwner: u.isPrimaryOwner === true,
      emailVerified: u.emailVerified !== false,
      isOnline: u.isOnline,
    };

    setTimeout(() => {
      try {
        UserService.onCreate?.(createdUserRecord);
      } catch (err) {
        console.error("Error in UserService.onCreate hook:", "[REDACTED_ERROR]");
      }
    }, 0);

    return createdUserRecord;
  }

  // Update simple user metadata/metrics
  static async updateUser(user: Partial<UserRecord> & { id: string }): Promise<void> {
    const client = getPrisma();
    const updateData: any = {};
    if (user.email !== undefined) updateData.email = user.email.trim().toLowerCase();
    if (user.profileEmail !== undefined) updateData.profileEmail = user.profileEmail ? user.profileEmail.trim().toLowerCase() : null;
    if (user.role !== undefined) updateData.role = user.role;
    if (user.name !== undefined) updateData.name = user.name;
    if (user.avatar !== undefined || user.avatarUrl !== undefined) {
      const img = user.avatarUrl || user.avatar;
      // DEFENSIVE: Only write avatar if it is a meaningful non-empty value.
      // Empty string "" must not overwrite a valid existing avatar — this prevents
      // accidental clears from presence sync, stale client state, or incomplete payloads.
      // Legitimate avatar deletion should explicitly pass a sentinel or go through
      // the authenticated profile-update endpoint with explicit user intent.
      if (img !== undefined && img !== null && img !== "") {
        updateData.avatar = img;
        updateData.avatarUrl = img;
      }
    }
    if (user.totalPoints !== undefined) updateData.totalPoints = user.totalPoints;
    if (user.level !== undefined) updateData.level = user.level;
    if (user.levelBadge !== undefined) updateData.levelBadge = user.levelBadge;
    if (user.streakDays !== undefined) updateData.streakDays = user.streakDays;
    if (user.studentGroup !== undefined) updateData.studentGroup = user.studentGroup;
    if (user.totalTimeSpent !== undefined) updateData.totalTimeSpent = user.totalTimeSpent;
    if (user.lastActive !== undefined) updateData.lastActive = new Date(user.lastActive);
    if (user.accountStatus !== undefined) updateData.accountStatus = user.accountStatus === "banned" ? "BANNED" : user.accountStatus === "pending_profile" ? "PENDING_PROFILE" : user.accountStatus === "pending" ? "PENDING" : "ACTIVE";
    if (user.isOnline !== undefined) updateData.isOnline = !!user.isOnline;
    if (user.signature !== undefined) {
      // Allow empty string "" — this is how the frontend explicitly clears a signature
      // through the authenticated /api/auth/update-profile endpoint.
      // Protection is already provided at the architectural level: socket presence
      // updates no longer send profile fields, and /api/auth/sync does not send signature.
      if (user.signature !== null) {
        updateData.signature = user.signature;
      }
    }

    const u = await client.user.update({
      where: { id: user.id },
      data: updateData
    });

    const updatedUserRecord = {
      id: u.id,
      email: u.email,
      profileEmail: u.profileEmail ?? null,
      role: (u.role === "admin" || u.role === "owner" ? u.role : "user") as "admin" | "user" | "owner",
      sessionVersion: u.sessionVersion,
      name: u.name || "",
      avatar: u.avatar || "",
      avatarUrl: u.avatarUrl || u.avatar || "",
      signature: u.signature,
      totalPoints: u.totalPoints,
      level: u.level,
      levelBadge: u.levelBadge,
      streakDays: u.streakDays,
      totalTimeSpent: u.totalTimeSpent,
      lastActive: u.lastActive ? u.lastActive.toISOString() : new Date().toISOString(),
      created_at: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
      accountStatus: u.accountStatus && u.accountStatus.toLowerCase() === "banned" ? "banned" : u.accountStatus === "PENDING_PROFILE" ? "pending_profile" : u.accountStatus === "PENDING" ? "pending" : "active",
      isPrimaryOwner: u.isPrimaryOwner === true,
      emailVerified: u.emailVerified !== false,
      isOnline: u.isOnline
    };

    setTimeout(() => {
      try {
        UserService.onUpdate?.(updatedUserRecord);
      } catch (err) {
        console.error("Error in UserService.onUpdate hook:", "[REDACTED_ERROR]");
      }
    }, 0);
  }

  // Delete user completely (cascades automatically)
  static async deleteUser(userId: string): Promise<boolean> {
    const client = getPrisma();
    try {
      // Atomic cascading deletes of dependent records
      await client.$transaction([
        client.lectureProgress.deleteMany({ where: { userId } }),
        client.pointsLog.deleteMany({ where: { userId } }),
        client.userProgress.deleteMany({ where: { userId } }),
        client.notification.deleteMany({ where: { targetUserId: userId } }),
        client.user.delete({ where: { id: userId } })
      ]);

      setTimeout(() => {
        try {
          UserService.onDelete?.(userId);
        } catch (err) {
          console.error("Error in UserService.onDelete hook:", "[REDACTED_ERROR]");
        }
      }, 0);

      return true;
    } catch (err) { console.error("findById error:", err);
      return false;
    }
  }

  // Fetch all users with basic metrics
  static async listAllUsers(): Promise<any[]> {
    const client = getPrisma();
    const allUsers = await client.user.findMany({
      take: 1000,
      include: {
        lectureProgresses: true
      }
    });

    const list: any[] = [];
    for (const u of allUsers) {
      const progressList = u.lectureProgresses || [];
      const completedLectCount = progressList.filter((p: any) => p.pdfCompleted === true).length;
      const completedQuizzesCount = progressList.filter((p: any) => p.quizCompleted === true).length;

      const mapped = {
        id: u.id,
        name: u.name || "",
        email: u.email,
        profileEmail: u.profileEmail ?? null,
        role: u.role,
        isAdmin: u.role === "admin",
        isPrimaryOwner: u.isPrimaryOwner === true,
        emailVerified: u.emailVerified !== false,
        avatar: u.avatar || "",
        avatarUrl: u.avatarUrl || u.avatar || "",
        totalPoints: u.totalPoints,
        level: u.level,
        levelBadge: u.levelBadge,
        streakDays: u.streakDays,
        totalTimeSpent: u.totalTimeSpent,
        lastActive: u.lastActive ? u.lastActive.toISOString() : new Date().toISOString(),
        created_at: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
        completedLectCount,
        completedQuizzesCount,
        progress: progressList.map((p: any) => ({
          userId: p.userId,
          lectureId: p.lectureId,
          pdfCompleted: p.pdfCompleted,
          notesCompleted: p.notesCompleted,
          videoCompleted: p.videoCompleted,
          flashcardsCompleted: p.flashcardsCompleted,
          quizCompleted: p.quizCompleted,
          quizScore: p.quizScore || 0,
          lastAccessed: p.lastAccessed ? p.lastAccessed.toISOString() : new Date().toISOString()
        }))
      };

      list.push(mapped);
    }

    list.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
    return list;
  }

  // Get progress records for a user
  static async getProgress(userId: string): Promise<ProgressRecord[]> {
    const client = getPrisma();
    const progressList = await client.lectureProgress.findMany({
      take: 2000,
      where: { userId }
    });
    return progressList.map((row: any) => ({
      userId: row.userId,
      lectureId: row.lectureId,
      pdfCompleted: !!row.pdfCompleted,
      notesCompleted: !!row.notesCompleted,
      videoCompleted: !!row.videoCompleted,
      flashcardsCompleted: !!row.flashcardsCompleted,
      quizCompleted: !!row.quizCompleted,
      quizScore: row.quizScore || 0,
      lastAccessed: row.lastAccessed ? row.lastAccessed.toISOString() : new Date().toISOString(),
    }));
  }

  // Save progress records for a user
  static async saveProgress(prog: ProgressRecord): Promise<void> {
    const client = getPrisma();
    await client.lectureProgress.upsert({
      where: {
        userId_lectureId: {
          userId: prog.userId,
          lectureId: prog.lectureId
        }
      },
      update: {
        pdfCompleted: prog.pdfCompleted,
        notesCompleted: prog.notesCompleted,
        videoCompleted: prog.videoCompleted,
        flashcardsCompleted: prog.flashcardsCompleted,
        quizCompleted: prog.quizCompleted,
        quizScore: prog.quizScore,
        lastAccessed: new Date()
      },
      create: {
        userId: prog.userId,
        lectureId: prog.lectureId,
        pdfCompleted: prog.pdfCompleted,
        notesCompleted: prog.notesCompleted,
        videoCompleted: prog.videoCompleted,
        flashcardsCompleted: prog.flashcardsCompleted,
        quizCompleted: prog.quizCompleted,
        quizScore: prog.quizScore,
        lastAccessed: new Date()
      }
    });
  }

  // Get academic points logs
  static async getPointsLogs(userId: string): Promise<PointsLogRecord[]> {
    const client = getPrisma();
    const logs = await client.pointsLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    return logs.map((row: any) => ({
      id: row.id,
      userId: row.userId,
      points: row.points,
      reason: row.reason,
      createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
    }));
  }

  // Save academic points log
  static async savePointsLog(log: PointsLogRecord): Promise<void> {
    const client = getPrisma();
    await client.pointsLog.upsert({
      where: { id: log.id },
      update: {
        points: log.points,
        reason: log.reason,
        createdAt: log.createdAt ? new Date(log.createdAt) : new Date()
      },
      create: {
        id: log.id,
        userId: log.userId,
        points: log.points,
        reason: log.reason,
        createdAt: log.createdAt ? new Date(log.createdAt) : new Date()
      }
    });
  }

  // Get custom calendar events (now handled client-side or managed via global calendar)
  static async getCalendarEvents(userId: string): Promise<any[]> {
    const client = getPrisma();
    const events = await client.calendarEvent.findMany({
      take: 2000,
      where: { userId }
    });
    return events.map((row: any) => ({
      id: row.id,
      title: row.title,
      date: row.startDateTime ? new Date(row.startDateTime).toISOString().split('T')[0] : "",
      time: row.startDateTime ? new Date(row.startDateTime).toTimeString().substring(0, 5) : "",
      type: row.eventType?.toLowerCase() || "other",
      completed: row.isCompleted
    }));
  }

  // Save custom calendar event
  static async saveCalendarEvent(evt: any): Promise<void> {
    const client = getPrisma();
    const startDateTime = evt.date ? new Date(`${evt.date}T${evt.time || "09:00"}:00`) : new Date();
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // +1 hr default

    await client.calendarEvent.upsert({
      where: { id: evt.id },
      update: {
        title: evt.title,
        eventType: (evt.type || "other").toUpperCase(),
        startDateTime,
        endDateTime,
        isCompleted: !!evt.completed
      },
      create: {
        id: evt.id,
        userId: evt.userId,
        title: evt.title,
        eventType: (evt.type || "other").toUpperCase(),
        startDateTime,
        endDateTime,
        isCompleted: !!evt.completed
      }
    });
  }

  // Delete calendar event
  static async deleteCalendarEvent(id: string): Promise<void> {
    const client = getPrisma();
    try {
      await client.calendarEvent.delete({
        where: { id }
      });
    } catch (err) { console.error("findById error:", err);
      // Ignore if does not exist
    }
  }

  // ── Auth-only methods — password hash is NEVER part of UserRecord ────────────

  /** Create a short-lived, hashed, single-use email verification token. */
  static async createEmailVerificationToken(userId: string): Promise<string> {
    const client = getPrisma();
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await client.$transaction(async (tx: any) => {
      await tx.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } });
      await tx.emailVerificationToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
    });
    return rawToken;
  }

  /** Atomically consume a verification token and mark its user verified. */
  static async verifyEmailToken(rawToken: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/i.test(rawToken)) return false;
    const client = getPrisma();
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    return client.$transaction(async (tx: any) => {
      const record = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (!record || record.usedAt || record.expiresAt <= new Date()) return false;

      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) return false;

      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerified: true, accountStatus: "ACTIVE" },
      });
      return true;
    });
  }

  /** Mark an account verified after a trusted provider assertion (for example Google). */
  static async markEmailVerified(userId: string): Promise<void> {
    const client = getPrisma();
    await client.user.update({ where: { id: userId }, data: { emailVerified: true, accountStatus: "ACTIVE" } });
  }

  /** Returns the bcrypt hash stored for a user, or null if the account has no password (OAuth-only). */
  static async getPasswordHash(userId: string): Promise<string | null> {
    const client = getPrisma();
    const row = await client.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    return row?.passwordHash ?? null;
  }

  /** Directly sets a bcrypt password hash (used after password reset). */
  static async setPasswordHash(userId: string, hash: string): Promise<void> {
    const client = getPrisma();
    await client.user.update({ where: { id: userId }, data: { passwordHash: hash } });
  }

  // ── Password reset token management (DB-persisted, SHA-256 hashed) ──────────

  private static hashResetToken(plaintext: string): string {
    return crypto.createHash("sha256").update(plaintext).digest("hex");
  }

  /**
   * Stores a new password-reset token in the database.
   * Previous unused tokens for the same user are deleted first (one active token per user).
   * The plaintext token is hashed with SHA-256 before storage — the DB never sees the raw token.
   */
  static async storeResetToken(userId: string, plaintextToken: string, expiresAt: Date): Promise<void> {
    const client = getPrisma();
    const tokenHash = UserService.hashResetToken(plaintextToken);
    // Invalidate any previous unused tokens for this user
    await client.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    await client.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  /**
   * Verifies and atomically consumes a reset token, then updates the password.
   * Returns `true` on success, `false` if the token is missing, expired, or already used.
   * The entire operation runs in a DB transaction to prevent race conditions.
   */
  static async verifyAndConsumeResetToken(
    userId: string,
    plaintextToken: string,
    newPasswordHash: string,
  ): Promise<boolean> {
    const client = getPrisma();
    const tokenHash = UserService.hashResetToken(plaintextToken);

    const record = await client.passwordResetToken.findFirst({
      where: { userId, tokenHash, usedAt: null },
    });
    if (!record) return false;
    if (record.expiresAt < new Date()) return false;

    // Claim the token atomically. Only the request that changes usedAt from null
    // may continue to update the password and invalidate existing sessions.
    return client.$transaction(async (tx: any) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, userId, tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) return false;

      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash, sessionVersion: { increment: 1 } },
      });
      return true;
    });
  }

  // Lightweight user-only fetch for session validation — skips the expensive
  // progress/pointsLogs/calendarEvents queries. Used by /api/auth/me on startup
  // when the client only needs to confirm the session is alive.
  static async getLiteUserData(userId: string, knownUser?: UserRecord): Promise<any> {
    const userRow = knownUser || await UserService.findById(userId);
    if (!userRow) return null;

    return {
      user: {
        id: userRow.id,
        name: userRow.name || "",
        email: userRow.email,
        profileEmail: userRow.profileEmail ?? null,
        avatar: userRow.avatar || "",
        avatarUrl: userRow.avatarUrl || userRow.avatar || "",
        signature: userRow.signature,
        totalPoints: userRow.totalPoints || 0,
        level: userRow.level || "Rising (Resident) 🔬",
        levelBadge: userRow.levelBadge || "Lvl 1",
        streakDays: userRow.streakDays || 0,
        totalTimeSpent: userRow.totalTimeSpent || 0,
        lastActive: userRow.lastActive,
        created_at: userRow.created_at,
        isAdmin: userRow.role === "admin",
        role: userRow.role,
        studentGroup: userRow.studentGroup || "A",
        isPrimaryOwner: userRow.isPrimaryOwner === true,
        emailVerified: userRow.emailVerified !== false,
        accountStatus: userRow.accountStatus || "active",
      },
    };
  }

  // Get full client-side view object for syncing
  static async getFullUserData(userId: string, knownUser?: UserRecord): Promise<any> {
    const userRow = knownUser || await UserService.findById(userId);
    if (!userRow) return null;

    const [progress, pointsLogs, calendarEvents] = await Promise.all([
      UserService.getProgress(userId),
      UserService.getPointsLogs(userId),
      UserService.getCalendarEvents(userId),
    ]);

    const mappedUser = {
      id: userRow.id,
      name: userRow.name || "",
      email: userRow.email,
      profileEmail: userRow.profileEmail ?? null,
      avatar: userRow.avatar || "",
      avatarUrl: userRow.avatarUrl || userRow.avatar || "",
      signature: userRow.signature,
      totalPoints: userRow.totalPoints || 0,
      level: userRow.level || "Rising (Resident) 🔬",
      levelBadge: userRow.levelBadge || "Lvl 1",
      streakDays: userRow.streakDays || 0,
      totalTimeSpent: userRow.totalTimeSpent || 0,
      lastActive: userRow.lastActive,
      created_at: userRow.created_at,
      isAdmin: userRow.role === "admin",
      role: userRow.role,
      studentGroup: userRow.studentGroup || "A",
      isPrimaryOwner: userRow.isPrimaryOwner === true,
      emailVerified: userRow.emailVerified !== false,
      accountStatus: userRow.accountStatus || "active",
    };

    return {
      user: mappedUser,
      progress,
      pointsLogs,
      calendarEvents
    };
  }
}
