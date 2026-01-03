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
    // Check if player already has a score - only keep their best
    const existingScores = Array.from(this.highScores.values());
    const existingPlayerScore = existingScores.find(
      s => s.playerName.toLowerCase() === insertScore.playerName.toLowerCase()
    );

    if (existingPlayerScore) {
      // Only update if new score is higher
      if (insertScore.score > existingPlayerScore.score) {
        const updatedScore: HighScore = {
          ...insertScore,
          id: existingPlayerScore.id
        };
        this.highScores.set(existingPlayerScore.id, updatedScore);
        return updatedScore;
      }
      // Return existing score if new one isn't higher
      return existingPlayerScore;
    }

    // New player - create new entry
    const id = randomUUID();
    const highScore: HighScore = { ...insertScore, id };
    this.highScores.set(id, highScore);
    return highScore;
  }
}

export const storage = new MemStorage();
