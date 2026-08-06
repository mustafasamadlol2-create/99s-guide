import { getPrisma } from "./prismaClient.js";

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  role: "admin" | "user" | "owner";
  name?: string;
  avatar?: string;
  avatarUrl?: string;
  totalPoints?: number;
  level?: string;
  levelBadge?: string;
  streakDays?: number;
  totalTimeSpent?: number;
  lastActive?: string;
  created_at?: string;
  studentGroup?: string;
  reset_token?: string;
  reset_token_expires?: string;
  accountStatus?: 'active' | 'banned';
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
  // Temporary memory storage for passcodes/reset tokens to avoid schema changes
  static resetTokens = new Map<string, { token: string; expires: string }>();

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
        where: { email: cleanEmail }
      });
      if (!u) return null;

      // Force owner role for designated protected accounts.
      // Must stay in sync with PRIMARY_OWNER_EMAIL / DEVELOPER_EMAIL in oauthService.ts.
      const PROTECTED_OWNER_EMAILS = [
        "mostafa.samad24001@comed.uobaghdad.edu.iq",
        "ss70eng1@gmail.com",
      ] as const;
      let role = u.role;
      if (PROTECTED_OWNER_EMAILS.includes(cleanEmail as any) && role !== "owner") {
        role = "owner";
        await client.user.update({
          where: { id: u.id },
          data: { role: "owner" }
        }).catch(err => console.error("Failed to auto-update owner role in findByEmail:", err));
      }

      const resetInfo = UserService.resetTokens.get(u.id);
      return {
        id: u.id,
        email: u.email,
        password_hash: u.passwordHash || "",
        role: (role === "admin" || role === "owner" ? role : "user") as "admin" | "user" | "owner",
        name: u.name || "",
        avatar: u.avatar || "",
        avatarUrl: u.avatarUrl || u.avatar || "",
        totalPoints: u.totalPoints,
        level: u.level,
        levelBadge: u.levelBadge,
        streakDays: u.streakDays,
        totalTimeSpent: u.totalTimeSpent,
        lastActive: u.lastActive ? u.lastActive.toISOString() : new Date().toISOString(),
        created_at: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
        accountStatus: u.accountStatus && u.accountStatus.toLowerCase() === "banned" ? "banned" : "active",
        isOnline: u.isOnline,
        studentGroup: u.studentGroup || "A",
        reset_token: resetInfo ? resetInfo.token : undefined,
        reset_token_expires: resetInfo ? resetInfo.expires : undefined
      };
    } catch (err) { console.error("findById error:", err);
      return null;
    }
  }

  // Find user by ID
  static async findById(id: string): Promise<UserRecord | null> {
    const client = getPrisma();
    try {
      const u = await client.user.findUnique({
        where: { id }
      });
      if (!u) return null;

      // Force owner role for designated protected accounts.
      // Must stay in sync with PRIMARY_OWNER_EMAIL / DEVELOPER_EMAIL in oauthService.ts.
      const PROTECTED_OWNER_EMAILS = [
        "mostafa.samad24001@comed.uobaghdad.edu.iq",
        "ss70eng1@gmail.com",
      ] as const;
      let role = u.role;
      const emailLower = u.email?.trim().toLowerCase() ?? "";
      if (PROTECTED_OWNER_EMAILS.includes(emailLower as any) && role !== "owner") {
        role = "owner";
        await client.user.update({
          where: { id: u.id },
          data: { role: "owner" }
        }).catch(err => console.error("Failed to auto-update owner role in findById:", err));
      }

      const resetInfo = UserService.resetTokens.get(u.id);
      return {
        id: u.id,
        email: u.email,
        password_hash: u.passwordHash || "",
        role: (role === "admin" || role === "owner" ? role : "user") as "admin" | "user" | "owner",
        name: u.name || "",
        avatar: u.avatar || "",
        avatarUrl: u.avatarUrl || u.avatar || "",
        totalPoints: u.totalPoints,
        level: u.level,
        levelBadge: u.levelBadge,
        streakDays: u.streakDays,
        totalTimeSpent: u.totalTimeSpent,
        lastActive: u.lastActive ? u.lastActive.toISOString() : new Date().toISOString(),
        created_at: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
        accountStatus: u.accountStatus && u.accountStatus.toLowerCase() === "banned" ? "banned" : "active",
        isOnline: u.isOnline,
        studentGroup: u.studentGroup || "A",
        reset_token: resetInfo ? resetInfo.token : undefined,
        reset_token_expires: resetInfo ? resetInfo.expires : undefined
      };
    } catch (err) { console.error("findById error:", err);
      return null;
    }
  }

  // Create new user (expects password_hash already hashed by AuthService)
  static async createUser(user: Omit<UserRecord, "created_at"> & { created_at?: string }): Promise<UserRecord> {
    const client = getPrisma();
    const cleanEmail = user.email.trim().toLowerCase();
    
    const u = await client.user.create({
      data: {
        id: user.id,
        email: cleanEmail,
        passwordHash: user.password_hash,
        role: user.role || "user",
        name: user.name || cleanEmail.split("@")[0],
        avatar: user.avatarUrl || user.avatar || "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=150&q=80",
        avatarUrl: user.avatarUrl || user.avatar || "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=150&q=80",
        totalPoints: user.totalPoints || 0,
        level: user.level || "Rising (Resident) 🔬",
        levelBadge: user.levelBadge || "Lvl 1",
        streakDays: user.streakDays || 0,
        totalTimeSpent: user.totalTimeSpent || 0,
        lastActive: user.lastActive ? new Date(user.lastActive) : new Date(),
        createdAt: user.created_at ? new Date(user.created_at) : new Date(),
        accountStatus: user.accountStatus === "banned" ? "BANNED" : "ACTIVE",
        isOnline: user.isOnline || false,
        studentGroup: user.studentGroup || "A"
      }
    });

    if (user.reset_token !== undefined) {
      UserService.resetTokens.set(u.id, {
        token: user.reset_token || "",
        expires: user.reset_token_expires || ""
      });
    }

    const createdUserRecord = {
      id: u.id,
      email: u.email,
      password_hash: u.passwordHash || "",
      role: (u.role === "admin" || u.role === "owner" ? u.role : "user") as "admin" | "user" | "owner",
      name: u.name || "",
      avatar: u.avatar || "",
      avatarUrl: u.avatarUrl || u.avatar || "",
      totalPoints: u.totalPoints,
      level: u.level,
      levelBadge: u.levelBadge,
      streakDays: u.streakDays,
      totalTimeSpent: u.totalTimeSpent,
      lastActive: u.lastActive ? u.lastActive.toISOString() : new Date().toISOString(),
      created_at: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
      accountStatus: (u.accountStatus && u.accountStatus.toLowerCase() === "banned" ? "banned" : "active") as "active" | "banned",
      isOnline: u.isOnline,
      reset_token: user.reset_token,
      reset_token_expires: user.reset_token_expires
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
    if (user.password_hash !== undefined) updateData.passwordHash = user.password_hash;
    if (user.role !== undefined) updateData.role = user.role;
    if (user.name !== undefined) updateData.name = user.name;
    if (user.avatar !== undefined || user.avatarUrl !== undefined) {
      const img = user.avatarUrl || user.avatar;
      if (img !== undefined) {
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
    if (user.accountStatus !== undefined) updateData.accountStatus = user.accountStatus === "banned" ? "BANNED" : "ACTIVE";
    if (user.isOnline !== undefined) updateData.isOnline = !!user.isOnline;

    const u = await client.user.update({
      where: { id: user.id },
      data: updateData
    });

    if (user.reset_token !== undefined) {
      if (!user.reset_token) {
        UserService.resetTokens.delete(user.id);
      } else {
        UserService.resetTokens.set(user.id, {
          token: user.reset_token,
          expires: user.reset_token_expires || ""
        });
      }
    }

    const updatedUserRecord = {
      id: u.id,
      email: u.email,
      password_hash: u.passwordHash || "",
      role: (u.role === "admin" || u.role === "owner" ? u.role : "user") as "admin" | "user" | "owner",
      name: u.name || "",
      avatar: u.avatar || "",
      avatarUrl: u.avatarUrl || u.avatar || "",
      totalPoints: u.totalPoints,
      level: u.level,
      levelBadge: u.levelBadge,
      streakDays: u.streakDays,
      totalTimeSpent: u.totalTimeSpent,
      lastActive: u.lastActive ? u.lastActive.toISOString() : new Date().toISOString(),
      created_at: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
      accountStatus: u.accountStatus && u.accountStatus.toLowerCase() === "banned" ? "banned" : "active",
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
        client.user.delete({ where: { id: userId } })
      ]);

      UserService.resetTokens.delete(userId);

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
  static async listAllUsers(includeSensitive = false): Promise<any[]> {
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

      const resetInfo = UserService.resetTokens.get(u.id);
      const mapped = {
        id: u.id,
        name: u.name || "",
        email: u.email,
        role: u.role,
        isAdmin: u.role === "admin",
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

      if (includeSensitive) {
        (mapped as any).password_hash = u.passwordHash || "";
        (mapped as any).reset_token = resetInfo ? resetInfo.token : undefined;
        (mapped as any).reset_token_expires = resetInfo ? resetInfo.expires : undefined;
      }
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

  // Get full client-side view object for syncing
  static async getFullUserData(userId: string): Promise<any> {
    const userRow = await UserService.findById(userId);
    if (!userRow) return null;

    const progress = await UserService.getProgress(userId);
    const pointsLogs = await UserService.getPointsLogs(userId);
    const calendarEvents = await UserService.getCalendarEvents(userId);

    const mappedUser = {
      id: userRow.id,
      name: userRow.name || "",
      email: userRow.email,
      avatar: userRow.avatar || "",
      avatarUrl: userRow.avatarUrl || userRow.avatar || "",
      totalPoints: userRow.totalPoints || 0,
      level: userRow.level || "Rising (Resident) 🔬",
      levelBadge: userRow.levelBadge || "Lvl 1",
      streakDays: userRow.streakDays || 0,
      totalTimeSpent: userRow.totalTimeSpent || 0,
      lastActive: userRow.lastActive,
      created_at: userRow.created_at,
      isAdmin: userRow.role === "admin",
      role: userRow.role,
      studentGroup: userRow.studentGroup || "A"
    };

    return {
      user: mappedUser,
      progress,
      pointsLogs,
      calendarEvents
    };
  }
}
