import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { UserService, UserRecord } from "./userService.js";

export class AuthService {
  // Use a secure work factor of 10-12
  private static SALT_ROUNDS = 10;

  // Hash plain text password securely
  static async hashPassword(password: string): Promise<string> {
    if (!password) {
      throw new Error("Password string is required for hashing.");
    }
    return bcrypt.hash(password, AuthService.SALT_ROUNDS);
  }

  // Verify entered password against salted hash
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    if (!password || !hash) return false;
    return bcrypt.compare(password, hash);
  }

  // Handle registration logic
  static async registerUser(data: {
    email: string;
    password?: string;
    name?: string;
    role?: "admin" | "user" | "owner";
    studentGroup?: string;
  }): Promise<UserRecord> {
    const { email, name, role } = data;
    const cleanEmail = email.trim().toLowerCase();
    
    // Check if user already exists
    const existing = await UserService.findByEmail(cleanEmail);
    if (existing) {
      throw new Error("Email is already registered.");
    }

    if (!data.password) {
      throw new Error("A password is required to register an account.");
    }
    const passwordHash = await AuthService.hashPassword(data.password);

    // UUIDs prevent concurrent sign-ups from generating the same ID.
    const userId = `usr_${randomUUID()}`;
    const newUser = await UserService.createUser({
      id: userId,
      email: cleanEmail,
      passwordHash,
      role: role || "user",
      name: name || cleanEmail.split("@")[0].replace(".", " "),
      studentGroup: data.studentGroup || "A",
      avatar: null,
      totalPoints: 10,
      level: "Rising (Resident) 🔬",
      levelBadge: "Lvl 1",
      streakDays: 3,
      totalTimeSpent: 0,
      lastActive: new Date().toISOString()
    });

    // The account is already valid if this auxiliary welcome log fails.
    // Do not report a successful account creation as a registration failure.
    try {
      await UserService.savePointsLog({
        id: `log_init_${randomUUID()}`,
        userId,
        points: 10,
        reason: "Welcome Award: Account profile generated successfully",
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("[AuthService] Welcome points log could not be created:", error instanceof Error ? error.message : "unknown error");
    }

    return newUser;
  }

  // Handle secure verification and authentication
  static async authenticateUser(email: string, password?: string): Promise<UserRecord> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await UserService.findByEmail(cleanEmail);
    
    if (!user) {
      throw new Error("Incorrect email address or candidate credentials.");
    }

    if (!password) {
      throw new Error("Password verification is required.");
    }

    // Fetch the password hash directly from DB — it is never included in UserRecord
    const hash = await UserService.getPasswordHash(user.id);
    if (!hash) {
      // OAuth-only account — no password set
      throw new Error("Incorrect password or security credentials.");
    }
    const match = await AuthService.verifyPassword(password, hash);
    if (!match) {
      throw new Error("Incorrect password or security credentials.");
    }

    // Refresh last active timestamp
    await UserService.updateUser({
      id: user.id,
      lastActive: new Date().toISOString()
    });

    return user;
  }
}
