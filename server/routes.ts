import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertHighScoreSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/highscores", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const scores = await storage.getHighScores(limit);
      res.json(scores);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch high scores" });
    }
  });

  app.post("/api/highscores", async (req, res) => {
    try {
      const parseResult = insertHighScoreSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid score data", details: parseResult.error.errors });
      }
      
      const newScore = await storage.createHighScore(parseResult.data);
      res.status(201).json(newScore);
    } catch (error) {
      res.status(500).json({ error: "Failed to save high score" });
    }
  });

  return httpServer;
}
