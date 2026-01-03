import { type User, type InsertUser, type HighScore, type InsertHighScore } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getHighScores(limit?: number): Promise<HighScore[]>;
  createHighScore(score: InsertHighScore): Promise<HighScore>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private highScores: Map<string, HighScore>;

  constructor() {
    this.users = new Map();
    this.highScores = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getHighScores(limit: number = 10): Promise<HighScore[]> {
    const scores = Array.from(this.highScores.values());
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async createHighScore(insertScore: InsertHighScore): Promise<HighScore> {
    const id = randomUUID();
    const highScore: HighScore = { ...insertScore, id };
    this.highScores.set(id, highScore);
    return highScore;
  }
}

export const storage = new MemStorage();
