import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Play, RotateCcw, Pause, Volume2, VolumeX, Trophy, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSound } from "@/hooks/useSound";
import type { HighScore } from "@shared/schema";

type GameState = "start" | "playing" | "paused" | "gameover";

interface Obstacle {
  x: number;
  type: "spike" | "mushroom" | "gap" | "ramp";
  width: number;
  height: number;
  passed: boolean;
}

interface Vine {
  x: number;
  anchorY: number;
  length: number;
  angle: number;
  angularVelocity: number;
}

interface Coin {
  x: number;
  y: number;
  collected: boolean;
  rotation: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface TerrainSegment {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
}

interface PoliceCar {
  x: number;
  speed: number;
}

interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  state: "running" | "jumping" | "sliding" | "swinging" | "falling";
  animFrame: number;
  onVine: Vine | null;
  invincible: number;
}

const GRAVITY = 0.6;
const JUMP_FORCE = -14;
const BASE_GROUND_Y = 350;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 50;
const SLIDE_HEIGHT = 25;
const PLAYER_BASE_SPEED = 6;
const POLICE_SPEED = 6.8;
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const THE_ABYSS = 2000; // Physics height inside pits (non-grounding)

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>("start");
  const [score, setScore] = useState(0);
  const [distance, setDistance] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem("runnerHighScore");
    return saved ? parseInt(saved) : 0;
  });
  const [coins, setCoins] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem("playerName") || "Player";
  });
  const [policeWarning, setPoliceWarning] = useState(0);

  // Sound effects
  const { playJump, playCoin, playGameOver, playSiren, playVineGrab, playVineRelease } = useSound({ enabled: soundEnabled });

  // Refs for sound functions to use in game loop without re-render dependencies
  const soundRef = useRef({ playJump, playCoin, playGameOver, playSiren, playVineGrab, playVineRelease });
  soundRef.current = { playJump, playCoin, playGameOver, playSiren, playVineGrab, playVineRelease };

  const { data: leaderboard = [] } = useQuery<HighScore[]>({
    queryKey: ["/api/highscores"],
  });

  const submitScoreMutation = useMutation({
    mutationFn: async (scoreData: { playerName: string; score: number; distance: number; coins: number }) => {
      return apiRequest("POST", "/api/highscores", scoreData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/highscores"] });
    },
  });

  const gameRef = useRef({
    player: {
      x: CANVAS_WIDTH / 3,
      y: BASE_GROUND_Y - PLAYER_HEIGHT,
      vx: PLAYER_BASE_SPEED,
      vy: 0,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      state: "running" as Player["state"],
      animFrame: 0,
      onVine: null as Vine | null,
      invincible: 0,
    },
    police: {
      x: -200,
      speed: POLICE_SPEED,
    } as PoliceCar,
    cameraX: 0,
    obstacles: [] as Obstacle[],
    vines: [] as Vine[],
    coinsList: [] as Coin[],
    particles: [] as Particle[],
    terrain: [] as TerrainSegment[],
    distanceTraveled: 0,
    scoreValue: 0,
    coinsCollected: 0,
    frameCount: 0,
    keys: { up: false, down: false },
    lastDisplayedScore: 0,
    lastDisplayedDistance: 0,
    lastDisplayedCoins: 0,
    lastDisplayedWarning: 0,
    worldX: 0,
    nextTerrainX: 0,
    lastObstacleX: 0,
    lastVineX: 0,
    lastCoinX: 0,
    vineSwingTime: 0,
    vineGrabCooldown: 0,
    rain: Array.from({ length: 100 }, () => ({
      x: Math.random() * CANVAS_WIDTH,
      y: Math.random() * CANVAS_HEIGHT,
      l: Math.random() * 20 + 10,
      v: Math.random() * 10 + 10,
    })),
    fireflies: Array.from({ length: 20 }, () => ({
      x: Math.random() * CANVAS_WIDTH,
      y: Math.random() * CANVAS_HEIGHT,
      s: Math.random() * 2 + 1,
      o: Math.random() * Math.PI * 2,
    })),
    shake: 0,
  });

  const getTerrainHeight = useCallback((worldX: number): number => {
    const game = gameRef.current;

    // Force pits to be flat and at BASE_GROUND_Y
    const inGap = game.obstacles.some(o => o.type === "gap" && worldX >= o.x && worldX <= o.x + o.width);
    if (inGap) return BASE_GROUND_Y;

    for (const segment of game.terrain) {
      if (worldX >= segment.startX && worldX < segment.endX) {
        const t = (worldX - segment.startX) / (segment.endX - segment.startX);
        return segment.startY + (segment.endY - segment.startY) * t;
      }
    }
    return BASE_GROUND_Y;
  }, []);

  const generateTerrain = useCallback((startX: number, count: number) => {
    const game = gameRef.current;
    let currentX = startX;
    let currentY = game.terrain.length > 0
      ? game.terrain[game.terrain.length - 1].endY
      : BASE_GROUND_Y;

    for (let i = 0; i < count; i++) {
      const segmentWidth = 150 + Math.random() * 200;
      const heightChange = (Math.random() - 0.5) * 80;
      let targetY = currentY + heightChange;
      targetY = Math.max(280, Math.min(400, targetY));

      game.terrain.push({
        startX: currentX,
        endX: currentX + segmentWidth,
        startY: currentY,
        endY: targetY,
      });

      currentX += segmentWidth;
      currentY = targetY;
    }
    game.nextTerrainX = currentX;
  }, []);

  const resetGame = useCallback(() => {
    const game = gameRef.current;
    game.player = {
      x: CANVAS_WIDTH / 3,
      y: BASE_GROUND_Y - PLAYER_HEIGHT,
      vx: PLAYER_BASE_SPEED,
      vy: 0,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      state: "running",
      animFrame: 0,
      onVine: null,
      invincible: 0,
    };
    game.police = {
      x: -200,
      speed: POLICE_SPEED,
    };
    game.cameraX = 0;
    game.obstacles = [];
    game.vines = [];
    game.coinsList = [];
    game.particles = [];
    game.terrain = [];
    game.distanceTraveled = 0;
    game.scoreValue = 0;
    game.coinsCollected = 0;
    game.frameCount = 0;
    game.worldX = 0;
    game.nextTerrainX = 0;
    game.lastObstacleX = 0;
    game.lastVineX = 0;
    game.lastCoinX = 0;
    game.vineSwingTime = 0;
    game.vineGrabCooldown = 0;

    generateTerrain(0, 20);

    setScore(0);
    setDistance(0);
    setCoins(0);
    setPoliceWarning(0);
  }, [generateTerrain]);

  const startGame = useCallback(() => {
    resetGame();
    setGameState("playing");
  }, [resetGame]);

  const togglePause = useCallback(() => {
    setGameState(prev => prev === "playing" ? "paused" : "playing");
  }, []);

  const gameOver = useCallback(() => {
    const game = gameRef.current;
    const finalScore = game.scoreValue;
    const finalDistance = Math.floor(game.distanceTraveled);
    const finalCoins = game.coinsCollected;

    if (finalScore > highScore) {
      setHighScore(finalScore);
      localStorage.setItem("runnerHighScore", finalScore.toString());
    }

    if (finalScore > 0) {
      // Validate player name - use trimmed name or default to 'Player'
      const validatedName = playerName.trim() || 'Player';
      submitScoreMutation.mutate({
        playerName: validatedName,
        score: finalScore,
        distance: finalDistance,
        coins: finalCoins,
      });
    }

    setGameState("gameover");
    soundRef.current.playGameOver();
  }, [highScore, playerName, submitScoreMutation]);

  const spawnVine = useCallback((worldX: number) => {
    const game = gameRef.current;
    game.vines.push({
      x: worldX,
      anchorY: 20,
      length: 180 + Math.random() * 80,
      angle: -Math.PI / 4,
      angularVelocity: 0,
    });
    game.lastVineX = worldX;
  }, []);

  const spawnObstacle = useCallback((worldX: number) => {
    const game = gameRef.current;
    const types: Obstacle["type"][] = ["spike", "mushroom", "gap", "ramp"];
    const type = types[Math.floor(Math.random() * types.length)];

    let width = 60;
    let height = 40;

    switch (type) {
      case "spike":
        width = 30;
        height = 40;
        break;
      case "mushroom":
        width = 40;
        height = 30;
        break;
      case "gap":
        width = 600 + Math.random() * 400; // Ginormous pits
        height = 300;
        // Guarantee a vine before the gap
        spawnVine(worldX - 150);
        game.lastVineX = worldX + width; // Mark the gap region as occupied to prevent autonomous vine clusters
        break;
      case "ramp":
        width = 120;
        height = 50;
        break;
    }

    game.obstacles.push({
      x: worldX,
      type,
      width,
      height,
      passed: false,
    });
    game.lastObstacleX = worldX;
    if (type === "gap") game.lastVineX = worldX;
  }, [spawnVine]);

  const spawnCoin = useCallback((worldX: number, groundY: number) => {
    const game = gameRef.current;
    const yPositions = [groundY - 80, groundY - 130, groundY - 180];
    game.coinsList.push({
      x: worldX,
      y: yPositions[Math.floor(Math.random() * yPositions.length)],
      collected: false,
      rotation: 0,
    });
    game.lastCoinX = worldX;
  }, []);

  const createParticles = useCallback((x: number, y: number, color: string, count: number) => {
    const game = gameRef.current;
    for (let i = 0; i < count; i++) {
      game.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8 - 2,
        life: 1,
        color,
      });
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === " ") {
        e.preventDefault();
        game.keys.up = true;
      }
      if (e.key === "ArrowDown" || e.key === "s") {
        e.preventDefault();
        game.keys.down = true;
      }
      if (e.key === "Escape" && gameState === "playing") {
        togglePause();
      }
      if (e.key === "Enter" && gameState === "start") {
        startGame();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === " ") {
        game.keys.up = false;
      }
      if (e.key === "ArrowDown" || e.key === "s") {
        game.keys.down = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [gameState, togglePause, startGame]);

  useEffect(() => {
    if (gameState !== "playing") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const game = gameRef.current;

    // Robust initialization for HMR stability
    if (!game.rain) {
      game.rain = Array.from({ length: 100 }, () => ({
        x: Math.random() * CANVAS_WIDTH,
        y: Math.random() * CANVAS_HEIGHT,
        l: Math.random() * 20 + 10,
        v: Math.random() * 10 + 10,
      }));
    }
    if (!game.fireflies) {
      game.fireflies = Array.from({ length: 20 }, () => ({
        x: Math.random() * CANVAS_WIDTH,
        y: Math.random() * CANVAS_HEIGHT,
        s: Math.random() * 2 + 1,
        o: Math.random() * Math.PI * 2,
      }));
    }
    if (game.shake === undefined) game.shake = 0;

    const drawBackground = () => {
      // Deep Jungle Sky Gradient
      const skyGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      skyGradient.addColorStop(0, "#022c22"); // Ultra deep teal
      skyGradient.addColorStop(0.4, "#064e3b");
      skyGradient.addColorStop(1, "#065f46");
      ctx.fillStyle = skyGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Atmospheric Fog / Horizon Depth
      const fogGradient = ctx.createLinearGradient(0, canvas.height * 0.4, 0, canvas.height);
      fogGradient.addColorStop(0, "rgba(5, 150, 105, 0)");
      fogGradient.addColorStop(1, "rgba(20, 184, 166, 0.2)");
      ctx.fillStyle = fogGradient;
      ctx.fillRect(0, canvas.height * 0.4, canvas.width, canvas.height * 0.6);

      // 1. Distant Parallax Layer: Far Silhouettes
      ctx.fillStyle = "#011c15";
      for (let i = 0; i < 6; i++) {
        const x = ((i * 300 - game.cameraX * 0.05) % (canvas.width + 600)) - 300;
        const height = 200 + (i % 3) * 80;
        ctx.fillRect(x, canvas.height - height - 100, 40, height + 100);

        ctx.beginPath();
        ctx.moveTo(x - 60, canvas.height - height - 80);
        ctx.lineTo(x + 20, canvas.height - height - 150);
        ctx.lineTo(x + 100, canvas.height - height - 80);
        ctx.fill();
      }

      // 2. God Rays (Light Rays)
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const rayGradient = ctx.createLinearGradient(0, 0, 200, 400);
      rayGradient.addColorStop(0, "rgba(255, 255, 200, 0.15)");
      rayGradient.addColorStop(1, "rgba(255, 255, 200, 0)");
      ctx.fillStyle = rayGradient;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        const startX = (i * 250 - (game.cameraX * 0.1) % 400) + 100;
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX + 150, 0);
        ctx.lineTo(startX - 200, 600);
        ctx.lineTo(startX - 350, 600);
        ctx.fill();
      }
      ctx.restore();

      // 3. Middle Parallax Layer: Thicker Trees
      ctx.fillStyle = "#022c22";
      for (let i = 0; i < 8; i++) {
        const x = ((i * 220 - game.cameraX * 0.2) % (canvas.width + 400)) - 200;
        const height = 150 + (i % 4) * 50;
        // Tree Trunk
        ctx.fillRect(x, canvas.height - height - 150, 50, height + 150);
        // Foliage "clumps"
        ctx.beginPath();
        ctx.arc(x + 25, canvas.height - height - 150, 60, 0, Math.PI * 2);
        ctx.arc(x - 10, canvas.height - height - 120, 45, 0, Math.PI * 2);
        ctx.arc(x + 60, canvas.height - height - 120, 45, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Close Foliage (Foreground Blur)
      ctx.fillStyle = "#01211b";
      for (let i = 0; i < 10; i++) {
        const x = ((i * 150 - game.cameraX * 0.4) % (canvas.width + 300)) - 150;
        const height = 80 + (i % 3) * 40;
        ctx.beginPath();
        ctx.ellipse(x + 75, canvas.height - 100, 60, height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawTerrain = () => {
      ctx.save();
      const visibleStart = game.cameraX - 100;
      const visibleEnd = game.cameraX + canvas.width + 100;

      // Helper to draw a contiguous terrain block
      const drawBlock = (segments: any[], layer: "soil" | "stone" | "moss") => {
        if (segments.length === 0) return;

        ctx.beginPath();
        const first = segments[0];
        const last = segments[segments.length - 1];

        if (layer === "soil") {
          ctx.moveTo(first.startX - game.cameraX, first.startY + 40);
          segments.forEach(s => ctx.lineTo(s.endX - game.cameraX, s.endY + 40));
          ctx.lineTo(last.endX - game.cameraX, canvas.height);
          ctx.lineTo(first.startX - game.cameraX, canvas.height);
          ctx.fill();
        } else if (layer === "stone") {
          ctx.moveTo(first.startX - game.cameraX, first.startY);
          segments.forEach(s => ctx.lineTo(s.endX - game.cameraX, s.endY));
          ctx.lineTo(last.endX - game.cameraX, canvas.height);
          ctx.lineTo(first.startX - game.cameraX, canvas.height);
          ctx.fill();
        } else { // moss
          ctx.moveTo(first.startX - game.cameraX, first.startY);
          segments.forEach(s => ctx.lineTo(s.endX - game.cameraX, s.endY));
          ctx.stroke();
        }
      };

      // Group segments into "mainland" blocks separated by gaps
      const blocks: any[][] = [];
      let currentBlock: any[] = [];

      game.terrain.forEach(segment => {
        if (segment.endX < visibleStart || segment.startX > visibleEnd) return;

        const inGap = game.obstacles.some((o: any) => o.type === "gap" && segment.startX >= o.x && segment.endX <= o.x + o.width);

        if (inGap) {
          if (currentBlock.length > 0) blocks.push(currentBlock);
          currentBlock = [];
        } else {
          currentBlock.push(segment);
        }
      });
      if (currentBlock.length > 0) blocks.push(currentBlock);

      // 1. Deep soil
      ctx.fillStyle = "#2d1b0d";
      blocks.forEach(b => drawBlock(b, "soil"));

      // 2. Stone/Earth
      const stoneGradient = ctx.createLinearGradient(0, BASE_GROUND_Y, 0, canvas.height);
      stoneGradient.addColorStop(0, "#4a3728");
      stoneGradient.addColorStop(1, "#2d1b0d");
      ctx.fillStyle = stoneGradient;
      blocks.forEach(b => drawBlock(b, "stone"));

      // 3. Mossy Top
      ctx.strokeStyle = "#064e3b";
      ctx.lineWidth = 14;
      ctx.lineJoin = "round";
      blocks.forEach(b => drawBlock(b, "moss"));

      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 6;
      blocks.forEach(b => drawBlock(b, "moss"));

      ctx.restore();
    };

    const drawPlayer = () => {
      const p = game.player;
      const screenX = p.x - game.cameraX;

      ctx.save();

      // Character Shadow
      const groundY = getTerrainHeight(p.x + p.width / 2);
      if (p.y + p.height < groundY + 10) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
        ctx.beginPath();
        ctx.ellipse(screenX + p.width / 2, groundY, p.width / 1.5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Speed Lines (Visual feedback for boost)
      if (p.vx > PLAYER_BASE_SPEED + 3) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const sy = p.y + 10 + i * 20;
          ctx.beginPath();
          ctx.moveTo(screenX - 20 - Math.random() * 20, sy);
          ctx.lineTo(screenX - 5, sy);
          ctx.stroke();
        }
      }

      if (p.invincible > 0 && Math.floor(game.frameCount / 5) % 2 === 0) {
        ctx.globalAlpha = 0.5;
      }

      if (p.state === "swinging" && p.onVine) {
        ctx.translate(screenX + p.width / 2, p.y + p.height / 2);
        ctx.rotate(p.onVine.angle * 0.3);
        ctx.translate(-(screenX + p.width / 2), -(p.y + p.height / 2));
      }

      const bounce = p.state === "running" ? Math.sin(game.frameCount * 0.3) * 2 : 0;

      if (p.state === "sliding") {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(screenX, p.y + p.height - SLIDE_HEIGHT, p.width + 10, SLIDE_HEIGHT - 5);

        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#1a1a1a";
          ctx.fillRect(screenX + i * 12, p.y + p.height - SLIDE_HEIGHT, 12, SLIDE_HEIGHT - 5);
        }

        ctx.fillStyle = "#ffccbc";
        ctx.beginPath();
        ctx.arc(screenX + p.width + 5, p.y + p.height - SLIDE_HEIGHT / 2, 10, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(screenX + p.width - 5, p.y + p.height - SLIDE_HEIGHT / 2 - 8, 20, 8);
      } else {
        const stripeWidth = 8;
        const bodyTop = p.y + 20 + bounce;
        const bodyHeight = p.height - 35;

        for (let i = 0; i < Math.ceil((p.width - 10) / stripeWidth); i++) {
          ctx.fillStyle = i % 2 === 0 ? "#1a1a1a" : "#ffffff";
          const stripeX = screenX + 5 + i * stripeWidth;
          const width = Math.min(stripeWidth, screenX + p.width - 5 - stripeX);
          ctx.fillRect(stripeX, bodyTop, width, bodyHeight);
        }

        ctx.fillStyle = "#ffccbc";
        ctx.beginPath();
        ctx.arc(screenX + p.width / 2, p.y + 12 + bounce, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(screenX + p.width / 2 - 15, p.y + 8 + bounce, 30, 10);

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(screenX + p.width / 2 - 5, p.y + 12 + bounce, 3, 0, Math.PI * 2);
        ctx.arc(screenX + p.width / 2 + 5, p.y + 12 + bounce, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(screenX + 8, p.y + p.height - 15, 10, 15);
        ctx.fillRect(screenX + p.width - 18, p.y + p.height - 15, 10, 15);

        if (p.state === "running") {
          const legOffset = Math.sin(game.frameCount * 0.4) * 5;
          ctx.fillRect(screenX + 8 + legOffset, p.y + p.height - 15, 10, 15);
          ctx.fillRect(screenX + p.width - 18 - legOffset, p.y + p.height - 15, 10, 15);
        }

        ctx.fillStyle = "#8B4513";
        ctx.beginPath();
        ctx.ellipse(screenX + p.width + 5, p.y + 35 + bounce, 12, 8, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#FFD700";
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("$", screenX + p.width + 5, p.y + 38 + bounce);

        if (p.state === "jumping" || p.state === "falling") {
          ctx.fillStyle = "#ffccbc";
          ctx.fillRect(screenX - 5, p.y + 25, 10, 5);
          ctx.fillRect(screenX + p.width - 5, p.y + 25, 10, 5);
        } else if (p.state === "swinging") {
          ctx.fillStyle = "#ffccbc";
          ctx.fillRect(screenX + p.width / 2 - 3, p.y - 10, 6, 15);
        }
      }

      ctx.restore();
    };

    const drawPolice = () => {
      const police = game.police;
      const screenX = police.x - game.cameraX;

      if (screenX > -200) {
        ctx.save();
        const pGroundY = getTerrainHeight(police.x + 50);
        ctx.translate(0, pGroundY - BASE_GROUND_Y);

        // Body (Realistic black sedan)
        ctx.fillStyle = "#0c0a09"; // Stone-950
        ctx.fillRect(screenX, BASE_GROUND_Y - 45, 100, 35);
        ctx.fillStyle = "#1c1917"; // Stone-900 hood/roof
        ctx.fillRect(screenX + 15, BASE_GROUND_Y - 65, 60, 20);

        // Windows (Reflective)
        const windsheildGradient = ctx.createLinearGradient(screenX + 20, BASE_GROUND_Y - 60, screenX + 70, BASE_GROUND_Y - 50);
        windsheildGradient.addColorStop(0, "#44403c");
        windsheildGradient.addColorStop(0.5, "#78716c");
        windsheildGradient.addColorStop(1, "#44403c");
        ctx.fillStyle = windsheildGradient;
        ctx.fillRect(screenX + 20, BASE_GROUND_Y - 60, 25, 12);
        ctx.fillRect(screenX + 50, BASE_GROUND_Y - 60, 20, 12);

        // Emergency Lights (Glow)
        const lightOn = Math.floor(game.frameCount / 5) % 2 === 0;
        ctx.shadowBlur = 15;
        ctx.shadowColor = lightOn ? "#ef4444" : "#3b82f6";
        ctx.fillStyle = lightOn ? "#ef4444" : "#3b82f6";
        ctx.beginPath(); ctx.arc(screenX + 35, BASE_GROUND_Y - 70, 8, 0, Math.PI * 2); ctx.fill();
        ctx.shadowColor = lightOn ? "#3b82f6" : "#ef4444";
        ctx.fillStyle = lightOn ? "#3b82f6" : "#ef4444";
        ctx.beginPath(); ctx.arc(screenX + 55, BASE_GROUND_Y - 70, 8, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Wheels
        ctx.fillStyle = "#000000";
        ctx.beginPath(); ctx.arc(screenX + 20, BASE_GROUND_Y - 10, 12, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(screenX + 80, BASE_GROUND_Y - 10, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#44403c";
        ctx.beginPath(); ctx.arc(screenX + 20, BASE_GROUND_Y - 10, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(screenX + 80, BASE_GROUND_Y - 10, 5, 0, Math.PI * 2); ctx.fill();

        // Markings
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText("POLICE", screenX + 50, BASE_GROUND_Y - 30);
        ctx.restore();
      }
    };

    const drawObstacle = (obs: Obstacle) => {
      const screenX = obs.x - game.cameraX;
      const groundY = getTerrainHeight(obs.x + obs.width / 2);

      ctx.save();

      switch (obs.type) {
        case "spike":
          const spikeGradient = ctx.createLinearGradient(screenX, groundY, screenX, groundY - obs.height);
          spikeGradient.addColorStop(0, "#44403c"); // Dark steel
          spikeGradient.addColorStop(0.5, "#a8a29e"); // Highlight
          spikeGradient.addColorStop(1, "#44403c");
          ctx.fillStyle = spikeGradient;
          ctx.beginPath();
          ctx.moveTo(screenX, groundY);
          ctx.lineTo(screenX + obs.width / 2, groundY - obs.height);
          ctx.lineTo(screenX + obs.width, groundY);
          ctx.fill();
          // Sharp edge highlight
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.stroke();
          break;

        case "mushroom":
          // Stalk with texture
          ctx.fillStyle = "#f5f5f4";
          ctx.fillRect(screenX + obs.width / 3, groundY - obs.height / 2, obs.width / 3, obs.height / 2);

          // Organic Cap Gradient
          const capGradient = ctx.createRadialGradient(screenX + obs.width / 2, groundY - obs.height / 2, 0, screenX + obs.width / 2, groundY - obs.height / 2, obs.width / 2);
          capGradient.addColorStop(0, "#ef4444");
          capGradient.addColorStop(0.8, "#991b1b");
          capGradient.addColorStop(1, "#450a0a");
          ctx.fillStyle = capGradient;
          ctx.beginPath();
          ctx.ellipse(screenX + obs.width / 2, groundY - obs.height / 2, obs.width / 2, obs.height / 2, 0, 0, Math.PI * 2);
          ctx.fill();

          // Bioluminescent glow spots
          ctx.shadowBlur = 10;
          ctx.shadowColor = "#ffffff";
          ctx.fillStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(screenX + obs.width / 2, groundY - obs.height / 1.5, 5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(screenX + obs.width / 4, groundY - obs.height / 2, 4, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(screenX + obs.width / 1.4, groundY - obs.height / 2, 4, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          break;



        case "gap":
          const leftEdgeY = getTerrainHeight(obs.x, true);
          const rightEdgeY = getTerrainHeight(obs.x + obs.width, true);

          // Deep Abyss Polygon (Seals perfectly to real terrain edges)
          ctx.beginPath();
          ctx.moveTo(screenX, leftEdgeY);
          ctx.lineTo(screenX + obs.width, rightEdgeY);
          ctx.lineTo(screenX + obs.width, canvas.height);
          ctx.lineTo(screenX, canvas.height);
          ctx.closePath();

          const pitGradient = ctx.createLinearGradient(screenX, Math.min(leftEdgeY, rightEdgeY), screenX, canvas.height);
          pitGradient.addColorStop(0, "#000000");
          pitGradient.addColorStop(1, "#020617");
          ctx.fillStyle = pitGradient;
          ctx.fill();

          // Atmospheric Mist
          ctx.fillStyle = "rgba(5, 150, 105, 0.1)";
          ctx.fillRect(screenX, Math.max(leftEdgeY, rightEdgeY) + 40, obs.width, canvas.height);

          // Sharp edges at the pit (matching terrain height)
          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(screenX, leftEdgeY);
          ctx.lineTo(screenX, leftEdgeY + 40);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(screenX + obs.width, rightEdgeY);
          ctx.lineTo(screenX + obs.width, rightEdgeY + 40);
          ctx.stroke();
          break;

        case "ramp":
          const rampGradient = ctx.createLinearGradient(screenX, groundY, screenX + obs.width, groundY - obs.height);
          rampGradient.addColorStop(0, "#065f46");
          rampGradient.addColorStop(1, "#10b981");
          ctx.fillStyle = rampGradient;
          ctx.beginPath();
          ctx.moveTo(screenX, groundY);
          ctx.lineTo(screenX + obs.width, groundY - obs.height);
          ctx.lineTo(screenX + obs.width, groundY);
          ctx.closePath();
          ctx.fill();
          break;
      }

      ctx.restore();
    };

    const drawVine = (vine: Vine) => {
      ctx.save();
      const screenX = vine.x - game.cameraX;
      const endX = screenX + Math.sin(vine.angle) * vine.length;
      const endY = vine.anchorY + Math.cos(vine.angle) * vine.length;

      ctx.strokeStyle = "#2e7d32";
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(screenX, vine.anchorY);

      const cp1x = screenX + Math.sin(vine.angle * 0.5) * vine.length * 0.3;
      const cp1y = vine.anchorY + vine.length * 0.3;
      const cp2x = screenX + Math.sin(vine.angle * 0.8) * vine.length * 0.7;
      const cp2y = vine.anchorY + vine.length * 0.7;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
      ctx.stroke();

      ctx.strokeStyle = "#1b5e20";
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.fillStyle = "#4caf50";
      for (let i = 0; i < 5; i++) {
        const t = (i + 1) / 6;
        const leafX = screenX + Math.sin(vine.angle * t) * vine.length * t;
        const leafY = vine.anchorY + vine.length * t;
        ctx.beginPath();
        ctx.ellipse(leafX + 10, leafY, 8, 4, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "#8d6e63";
      ctx.beginPath();
      ctx.arc(screenX, vine.anchorY, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ff5722";
      ctx.beginPath();
      ctx.arc(endX, endY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawCoin = (coin: Coin) => {
      if (coin.collected) return;

      const screenX = coin.x - game.cameraX;

      ctx.save();
      ctx.translate(screenX, coin.y);
      ctx.rotate(coin.rotation);

      const scale = Math.abs(Math.cos(coin.rotation));
      ctx.scale(scale * 0.8 + 0.2, 1);

      const coinGradient = ctx.createRadialGradient(0, -2, 0, 0, 0, 12);
      coinGradient.addColorStop(0, "#fff59d");
      coinGradient.addColorStop(0.5, "#ffd700");
      coinGradient.addColorStop(1, "#ff8f00");
      ctx.fillStyle = coinGradient;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ff6f00";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#ff8f00";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", 0, 1);

      ctx.restore();
    };

    const drawParticles = () => {
      ctx.save();
      game.particles.forEach(p => {
        const screenX = p.x - game.cameraX;
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(screenX, p.y, 4 * p.life, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    };

    const drawRain = () => {
      ctx.save();
      ctx.strokeStyle = "rgba(173, 216, 230, 0.4)";
      ctx.lineWidth = 1;
      const p = game.player;
      const speedFactor = p.vx * 0.5;

      game.rain.forEach((r: { x: number, y: number, l: number, v: number }) => {
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x - speedFactor, r.y + r.l);
        ctx.stroke();

        r.y += r.v;
        r.x -= speedFactor;

        if (r.y > CANVAS_HEIGHT) {
          r.y = -20;
          r.x = Math.random() * CANVAS_WIDTH;
        }
        if (r.x < 0) r.x = CANVAS_WIDTH;
        if (r.x > CANVAS_WIDTH) r.x = 0;
      });
      ctx.restore();
    };

    const drawFireflies = () => {
      ctx.save();
      game.fireflies.forEach((f: { x: number, y: number, s: number, o: number }) => {
        // ... (existing firefly drawing logic)
        const glow = Math.sin(game.frameCount * 0.05 + f.o) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(200, 255, 100, ${glow * 0.8})`;
        ctx.shadowBlur = glow * 10;
        ctx.shadowColor = "rgba(200, 255, 100, 0.5)";

        const driftX = Math.cos(game.frameCount * 0.02 + f.o) * 20;
        const driftY = Math.sin(game.frameCount * 0.02 + f.o) * 20;

        ctx.beginPath();
        ctx.arc(f.x + driftX, f.y + driftY, f.s, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });
      ctx.restore();
    };

    const drawVignette = () => {
      const vignette = ctx.createRadialGradient(
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_HEIGHT * 0.4,
        CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_WIDTH * 0.7
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    };

    const checkCollision = (player: Player, obs: Obstacle): boolean => {
      if (player.invincible > 0) return false;

      const pLeft = player.x;
      const pRight = player.x + player.width;
      const pTop = player.y;
      const pBottom = player.y + (player.state === "sliding" ? SLIDE_HEIGHT : player.height);
      const groundY = getTerrainHeight(obs.x + obs.width / 2);

      switch (obs.type) {
        case "spike":
          const spikeLeft = obs.x + 5;
          const spikeRight = obs.x + obs.width - 5;
          const spikeTop = groundY - obs.height;
          const spikeBottom = groundY;
          return pRight > spikeLeft && pLeft < spikeRight && pBottom > spikeTop && pTop < spikeBottom;

        case "gap":
          const playerCenterXGap = player.x + player.width / 2;
          const gapLeft = obs.x - 10;
          const gapRight = obs.x + obs.width + 10;

          if (playerCenterXGap > gapLeft && playerCenterXGap < gapRight) {
            // Let the player fall. Death is handled in the update loop when y > screen height
            return false;
          }
          return false;

        case "mushroom":
        case "ramp":
          return false;
      }
      return false;
    };

    const update = () => {
      const p = game.player;
      game.frameCount++;

      if (game.shake > 0) game.shake *= 0.9;

      // Variables speed based on terrain slope
      const groundYAhead = getTerrainHeight(p.x + p.width / 2 + 20);
      const groundYBehind = getTerrainHeight(p.x + p.width / 2 - 20);
      const slope = (groundYAhead - groundYBehind) / 40;

      if (slope > 0.1) { // Upward slope
        p.vx = Math.max(4, p.vx - 0.05);
      } else if (slope < -0.1) { // Downward slope
        const boost = p.state === "sliding" ? 0.4 : 0.05;
        p.vx = Math.min(20, p.vx + boost); // Enhanced boost and raised cap
        if (p.state === "sliding") {
          const particleCount = p.vx > 12 ? 3 : 1;
          createParticles(p.x, p.y + p.height, "#ffffff", particleCount); // Intensified trail
        }
      } else {
        // Gradually return to base speed
        if (p.vx > PLAYER_BASE_SPEED) p.vx -= 0.02;
        if (p.vx < PLAYER_BASE_SPEED) p.vx += 0.01;
      }

      game.distanceTraveled += p.vx * 0.1;
      game.scoreValue = Math.floor(game.distanceTraveled * 10) + game.coinsCollected * 100;

      if (p.invincible > 0) p.invincible--;

      game.police.x += game.police.speed;

      const policeDistance = p.x - game.police.x;
      if (policeDistance < 400) {
        setPoliceWarning(Math.min(100, (400 - policeDistance) / 400 * 100));
        // Play siren sound with volume/rate based on distance
        if (game.frameCount % Math.max(10, Math.floor(policeDistance / 10)) === 0) {
          soundRef.current.playSiren();
        }
      } else {
        setPoliceWarning(0);
      }

      if (game.police.x + 40 >= p.x) { // Police caught the player
        createParticles(p.x, p.y + p.height / 2, "#ef4444", 20);
        gameOver();
        return;
      }

      if (p.y > CANVAS_HEIGHT) { // Player fell off the screen (in a gap)
        gameOver();
        return;
      }

      if (p.state === "swinging" && p.onVine) {
        const vine = p.onVine;

        const gravity = 0.002;
        vine.angularVelocity += -gravity * Math.sin(vine.angle);
        vine.angularVelocity *= 0.98; // Increased damping to reduce extreme swinging
        vine.angle += vine.angularVelocity;

        const vineScreenX = vine.x;
        p.x = vineScreenX + Math.sin(vine.angle) * vine.length - p.width / 2;
        p.y = vine.anchorY + Math.cos(vine.angle) * vine.length - p.height / 2;

        game.vineSwingTime = (game.vineSwingTime || 0) + 1;

        if (!game.keys.up && game.vineSwingTime > 15) {
          const releaseSpeed = vine.angularVelocity * vine.length;

          const forwardBoost = Math.max(0, Math.cos(vine.angle)) * Math.abs(releaseSpeed) * 1.5;
          p.vx = PLAYER_BASE_SPEED + forwardBoost;
          p.vy = -Math.abs(Math.sin(vine.angle) * releaseSpeed) * 1.2 - 6;

          p.vx = Math.max(PLAYER_BASE_SPEED + 1, Math.min(p.vx, PLAYER_BASE_SPEED * 3));

          p.state = "jumping";
          p.onVine = null;
          game.vineSwingTime = 0;
          createParticles(p.x + p.width / 2, p.y + p.height / 2, "#4caf50", 10);
          soundRef.current.playVineRelease();
        }
      } else {
        if (p.vx > PLAYER_BASE_SPEED) {
          p.vx -= 0.05;
        } else {
          p.vx = PLAYER_BASE_SPEED;
        }

        const groundY = getTerrainHeight(p.x + p.width / 2);

        if (game.keys.down && p.y >= groundY - PLAYER_HEIGHT - 5 && p.state !== "jumping") {
          p.state = "sliding";
          p.height = SLIDE_HEIGHT;
        } else if (!game.keys.down && p.state === "sliding") {
          p.state = "running";
          p.height = PLAYER_HEIGHT;
          p.y = groundY - PLAYER_HEIGHT;
        }

        if (game.keys.up && p.y >= groundY - PLAYER_HEIGHT - 5 && p.state !== "swinging") {
          p.vy = JUMP_FORCE;
          p.state = "jumping";
          createParticles(p.x + p.width / 2, p.y + p.height, "#8d6e63", 3);
          soundRef.current.playJump();
        }

        p.vy += GRAVITY;
        p.y += p.vy;
        p.x += p.vx;

        let onRamp = false;
        let overGap = false;

        game.obstacles.forEach(obs => {
          if (obs.type === "mushroom") {
            const obsGroundY = getTerrainHeight(obs.x + obs.width / 2);
            const dx = (p.x + p.width / 2) - (obs.x + obs.width / 2);
            const dy = (p.y + p.height) - obsGroundY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 40 && p.vy >= 0) {
              p.vy = -20; // High bounce
              p.vx += 2;  // Speed boost
              p.state = "jumping";
              createParticles(obs.x + obs.width / 2, obsGroundY, "#ff4081", 12);
              soundRef.current.playJump();
            }
          }
          if (obs.type === "ramp") {
            const obsGroundY = getTerrainHeight(obs.x + obs.width / 2);
            const rampProgress = (p.x + p.width / 2 - obs.x) / obs.width;
            if (rampProgress > 0 && rampProgress < 1) {
              const rampY = obsGroundY - (rampProgress * obs.height);
              if (p.y + p.height > rampY && p.vy >= 0) {
                p.y = rampY - p.height;
                p.vy = 0;
                onRamp = true;
                if (game.keys.down) {
                  p.vy = -8;
                  p.vx += 3;
                }
              }
            }
          }
          if (obs.type === "gap") {
            const playerCenterX = p.x + p.width / 2;
            if (playerCenterX > obs.x && playerCenterX < obs.x + obs.width) {
              overGap = true;
            }
          }
        });

        if (!onRamp && !overGap) {
          const currentGroundY = getTerrainHeight(p.x + p.width / 2);
          if (p.y + p.height >= currentGroundY) {
            p.y = currentGroundY - (p.state === "sliding" ? SLIDE_HEIGHT : PLAYER_HEIGHT);
            p.vy = 0;
            if (p.state === "jumping" || p.state === "falling") {
              p.state = game.keys.down ? "sliding" : "running";
              createParticles(p.x + p.width / 2, p.y + p.height, "#8d6e63", 2);
              game.shake = 8; // Impact shake
            }
          } else if (p.y > groundY - PLAYER_HEIGHT + 20 && p.state !== "jumping") {
            p.state = "falling";
          }
        } else if (overGap && p.state !== "jumping" && p.state !== "swinging") {
          p.state = "falling";
        }
      }

      game.vines.forEach(vine => {
        if (p.state !== "swinging" && !game.vineGrabCooldown) {
          const vineScreenX = vine.x;
          const vineEndX = vineScreenX + Math.sin(vine.angle) * vine.length;
          const vineEndY = vine.anchorY + Math.cos(vine.angle) * vine.length;

          const dx = (p.x + p.width / 2) - vineEndX;
          const dy = p.y - vineEndY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 50 && game.keys.up && p.vy <= 5) {
            p.state = "swinging";
            p.onVine = vine;
            game.vineSwingTime = 0;
            game.vineGrabCooldown = 15;

            const entrySpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            vine.angularVelocity = entrySpeed * 0.01 * (p.vx > 0 ? 1 : -1);

            p.vy = 0;
            soundRef.current.playVineGrab();
          }
        }
      });

      if (game.vineGrabCooldown > 0) {
        game.vineGrabCooldown--;
      }

      game.obstacles = game.obstacles.filter(obs => {
        if (checkCollision(p, obs)) {
          createParticles(p.x + p.width / 2, p.y + p.height / 2, "#e53935", 10);
          gameOver();
          return false;
        }

        return obs.x > game.cameraX - 200;
      });

      game.vines = game.vines.filter(vine => {
        return vine.x > game.cameraX - 200;
      });

      game.coinsList.forEach(coin => {
        coin.rotation += 0.1;

        if (!coin.collected) {
          const dx = (p.x + p.width / 2) - coin.x;
          const dy = (p.y + p.height / 2) - coin.y;
          if (Math.sqrt(dx * dx + dy * dy) < 30) {
            coin.collected = true;
            game.coinsCollected++;
            createParticles(coin.x, coin.y, "#ffd700", 8);
            soundRef.current.playCoin();
          }
        }
      });
      game.coinsList = game.coinsList.filter(c => c.x > game.cameraX - 200);

      game.particles = game.particles.filter(particle => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.2;
        particle.life -= 0.02;
        return particle.life > 0;
      });

      game.cameraX = p.x - CANVAS_WIDTH / 3;

      const spawnX = game.cameraX + CANVAS_WIDTH + 200;

      if (spawnX - game.lastObstacleX > 800 + Math.random() * 800) {
        spawnObstacle(spawnX);
      }

      if (spawnX - game.lastVineX > 1200 + Math.random() * 1200) {
        spawnVine(spawnX);
      }


      if (spawnX - game.lastCoinX > 400 + Math.random() * 400) {
        const groundY = getTerrainHeight(spawnX);
        spawnCoin(spawnX, groundY);
      }

      if (game.nextTerrainX < spawnX + 500) {
        generateTerrain(game.nextTerrainX, 10);
      }

      game.terrain = game.terrain.filter(seg => seg.endX > game.cameraX - 200);

      // Only update React state when values change (reduces re-renders)
      if (game.scoreValue !== game.lastDisplayedScore) {
        setScore(game.scoreValue);
        game.lastDisplayedScore = game.scoreValue;
      }
      const currentDistance = Math.floor(game.distanceTraveled);
      if (currentDistance !== game.lastDisplayedDistance) {
        setDistance(currentDistance);
        game.lastDisplayedDistance = currentDistance;
      }
      if (game.coinsCollected !== game.lastDisplayedCoins) {
        setCoins(game.coinsCollected);
        game.lastDisplayedCoins = game.coinsCollected;
      }
    };

    const drawRadar = () => {
      ctx.save();
      const centerX = CANVAS_WIDTH - 100;
      const centerY = CANVAS_HEIGHT - 100;
      const radius = 60;

      // Glassmorphic Circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Radar rings
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(centerX, centerY, radius * 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(centerX, centerY, radius * 0.3, 0, Math.PI * 2); ctx.stroke();

      // Player blip (Fixed in center)
      ctx.fillStyle = "#10b981";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#10b981";
      ctx.beginPath(); ctx.arc(centerX, centerY, 5, 0, Math.PI * 2); ctx.fill();

      // Police blip (Relative position)
      const policeDistance = game.player.x - game.police.x;
      const radarDistance = Math.min(policeDistance / 1000, 1) * radius;
      // Interpolate position (drawn on the left side of the radar)
      const blipX = centerX - radarDistance;

      ctx.shadowColor = "#ef4444";
      ctx.fillStyle = "#ef4444";
      ctx.beginPath(); ctx.arc(blipX, centerY, 6, 0, Math.PI * 2); ctx.fill();

      // Warning Pulse if close
      if (policeDistance < 300) {
        const pulse = (Math.sin(game.frameCount * 0.2) + 1) / 2;
        ctx.strokeStyle = `rgba(239, 68, 68, ${pulse * 0.5})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(blipX, centerY, 6 + pulse * 10, 0, Math.PI * 2); ctx.stroke();
      }

      ctx.restore();
    };

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      if (game.shake > 1) {
        const sx = (Math.random() - 0.5) * game.shake;
        const sy = (Math.random() - 0.5) * game.shake;
        ctx.translate(sx, sy);
      }

      drawBackground();
      drawFireflies();
      drawRain();

      drawRadar();

      game.vines.forEach(drawVine);

      drawTerrain();

      game.obstacles.forEach(drawObstacle);
      game.coinsList.forEach(drawCoin);

      drawPolice();
      drawPlayer();

      drawParticles();

      drawVignette();
      ctx.restore();
    };

    const gameLoop = () => {
      update();
      render();
      animationId = requestAnimationFrame(gameLoop);
    };

    animationId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [gameState, gameOver, spawnObstacle, spawnVine, spawnCoin, createParticles, getTerrainHeight, generateTerrain]);

  useEffect(() => {
    if (gameState !== "start" && gameState !== "gameover" && gameState !== "paused") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawStaticBackground = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "#1a1a2e");
      gradient.addColorStop(0.5, "#16213e");
      gradient.addColorStop(1, "#0f3460");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
      for (let i = 0; i < 80; i++) {
        const x = (i * 73) % canvas.width;
        const y = (i * 37) % (canvas.height * 0.7);
        const size = (i % 3) + 1;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      const groundGradient = ctx.createLinearGradient(0, BASE_GROUND_Y, 0, canvas.height);
      groundGradient.addColorStop(0, "#3d2817");
      groundGradient.addColorStop(0.3, "#2d1f12");
      groundGradient.addColorStop(1, "#1b0f0e");
      ctx.fillStyle = groundGradient;
      ctx.fillRect(0, BASE_GROUND_Y, canvas.width, canvas.height - BASE_GROUND_Y);
    };

    drawStaticBackground();
  }, [gameState]);

  return (
    <div className="relative w-full h-screen bg-background overflow-hidden flex items-center justify-center" data-testid="game-container">
      <div className="relative w-full max-w-5xl aspect-video">
        <canvas
          ref={canvasRef}
          width={960}
          height={540}
          className="w-full h-full rounded-lg shadow-2xl"
          data-testid="game-canvas"
        />

        {gameState === "playing" && (
          <>
            {/* Police Proximity Edge Glow */}
            <div
              className="absolute inset-0 pointer-events-none transition-opacity duration-300"
              style={{
                opacity: policeWarning / 100,
                boxShadow: "inset 0 0 100px rgba(239, 68, 68, 0.6)",
                background: "radial-gradient(circle, transparent 60%, rgba(239, 68, 68, 0.2) 100%)"
              }}
            />

            <div className="absolute top-0 left-0 right-0 p-6 flex items-start justify-between pointer-events-none">
              {/* Left HUD Panel */}
              <div className="flex flex-col gap-2 bg-black/40 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/10 shadow-xl">
                <div className="flex items-center gap-3">
                  <Trophy className="w-5 h-5 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]" />
                  <div className="text-3xl font-black text-white tracking-tight" data-testid="text-score">
                    {score.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                  <div className="text-sm font-bold text-white/70 uppercase tracking-widest" data-testid="text-coins">
                    {coins} COINS
                  </div>
                </div>
              </div>

              {/* Center Distance Panel */}
              <div className="bg-white/10 backdrop-blur-lg px-8 py-3 rounded-full border border-white/20 shadow-lg">
                <div className="text-xl font-bold text-white tracking-widest whitespace-nowrap" data-testid="text-distance">
                  {distance.toLocaleString()}M
                </div>
              </div>

              <div className="flex flex-col gap-3 items-end pointer-events-auto">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="bg-black/30 text-white"
                  data-testid="button-sound-toggle"
                >
                  {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={togglePause}
                  className="bg-black/30 text-white"
                  data-testid="button-pause"
                >
                  <Pause className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </>
        )}

        {gameState === "playing" && policeWarning > 0 && (
          <div className="absolute top-20 left-4 flex items-center gap-2 pointer-events-none animate-pulse">
            <AlertTriangle className="w-6 h-6 text-red-500" />
            <span className="text-red-500 font-bold drop-shadow-lg">POLICE CATCHING UP!</span>
          </div>
        )}

        {gameState === "playing" && (
          <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
            <div className="text-sm text-white/60 drop-shadow">
              Press UP to jump | DOWN to slide | Grab vines to swing!
            </div>
          </div>
        )}

        {gameState === "start" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 rounded-lg overflow-y-auto py-8">
            <h1
              className="text-4xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-orange-300 to-yellow-400 mb-2 md:mb-4 animate-pulse"
              style={{ fontFamily: "'Poppins', sans-serif" }}
              data-testid="text-game-title"
            >
              HEIST RUNNER
            </h1>
            <p className="text-lg md:text-xl text-white/80 mb-2">Escape the Police!</p>

            <div className="flex items-center gap-2 mb-4">
              <span className="text-white/70">Name:</span>
              <input
                type="text"
                value={playerName}
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  localStorage.setItem("playerName", e.target.value);
                }}
                className="px-3 py-1 bg-white/10 border border-white/20 rounded text-white text-center w-32"
                maxLength={12}
                data-testid="input-player-name"
              />
            </div>

            {highScore > 0 && (
              <p className="text-lg text-yellow-400 mb-4" data-testid="text-high-score">
                Your Best: {highScore.toLocaleString()}
              </p>
            )}

            <Button
              size="lg"
              onClick={startGame}
              className="px-12 py-6 text-xl font-bold rounded-full bg-gradient-to-r from-red-500 to-orange-600 hover:from-red-600 hover:to-orange-700 text-white shadow-lg shadow-red-500/30 transition-all duration-300"
              data-testid="button-play"
            >
              <Play className="w-6 h-6 mr-2" />
              Start Heist
            </Button>

            <Button
              variant="ghost"
              onClick={() => setShowLeaderboard(!showLeaderboard)}
              className="mt-4 text-white/70"
              data-testid="button-toggle-leaderboard"
            >
              <Trophy className="w-5 h-5 mr-2" />
              {showLeaderboard ? "Hide" : "Show"} Leaderboard
            </Button>

            {showLeaderboard && leaderboard.length > 0 && (
              <div className="mt-4 bg-black/40 rounded-lg p-4 w-full max-w-sm">
                <h3 className="text-lg font-bold text-white mb-3 text-center">Top Scores</h3>
                <div className="space-y-2">
                  {leaderboard.slice(0, 5).map((entry, index) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between text-white/80 px-2"
                      data-testid={`leaderboard-entry-${index}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`font-bold ${index === 0 ? "text-yellow-400" : index === 1 ? "text-gray-300" : index === 2 ? "text-amber-600" : ""}`}>
                          #{index + 1}
                        </span>
                        <span>{entry.playerName}</span>
                      </span>
                      <span className="font-mono">{entry.score.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 text-white/70 text-center max-w-md px-4">
              <p className="mb-2 font-semibold">How to Play:</p>
              <p className="text-sm">
                Use <span className="px-2 py-1 bg-white/20 rounded">UP</span> or <span className="px-2 py-1 bg-white/20 rounded">SPACE</span> to jump
              </p>
              <p className="text-sm mt-1">
                Use <span className="px-2 py-1 bg-white/20 rounded">DOWN</span> to slide under obstacles
              </p>
              <p className="text-sm mt-1">
                Grab vines and swing to escape! Release to launch forward!
              </p>
              <p className="text-sm mt-2 text-red-400">
                Stay ahead of the police or get caught!
              </p>
            </div>
          </div>
        )}

        {gameState === "paused" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 rounded-lg">
            <h2 className="text-4xl font-bold text-white mb-8" data-testid="text-paused">
              PAUSED
            </h2>
            <div className="flex flex-col gap-4">
              <Button
                size="lg"
                onClick={togglePause}
                className="px-10 py-5 text-lg font-semibold rounded-full bg-gradient-to-r from-red-500 to-orange-600"
                data-testid="button-resume"
              >
                <Play className="w-5 h-5 mr-2" />
                Resume
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={startGame}
                className="px-10 py-5 text-lg font-semibold rounded-full border-white/30 text-white"
                data-testid="button-restart-pause"
              >
                <RotateCcw className="w-5 h-5 mr-2" />
                Restart
              </Button>
            </div>
          </div>
        )}

        {gameState === "gameover" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 rounded-lg">
            <h2 className="text-4xl md:text-5xl font-black text-red-500 mb-4" data-testid="text-game-over">
              BUSTED!
            </h2>
            <div className="text-5xl font-bold text-white mb-6" data-testid="text-final-score">
              {score.toLocaleString()}
            </div>
            <div className="grid grid-cols-3 gap-6 mb-8">
              <Card className="p-4 bg-white/10 border-white/20 text-center">
                <div className="text-2xl font-bold text-white">{distance}m</div>
                <div className="text-sm text-white/60">Distance</div>
              </Card>
              <Card className="p-4 bg-white/10 border-white/20 text-center">
                <div className="text-2xl font-bold text-yellow-400">{coins}</div>
                <div className="text-sm text-white/60">Loot</div>
              </Card>
              <Card className="p-4 bg-white/10 border-white/20 text-center">
                <div className="text-2xl font-bold text-orange-400">{highScore.toLocaleString()}</div>
                <div className="text-sm text-white/60">Best</div>
              </Card>
            </div>
            <div className="flex gap-4">
              <Button
                size="lg"
                onClick={startGame}
                className="px-10 py-5 text-lg font-semibold rounded-full bg-gradient-to-r from-red-500 to-orange-600"
                data-testid="button-play-again"
              >
                <RotateCcw className="w-5 h-5 mr-2" />
                Try Again
              </Button>
            </div>
          </div>
        )}

        {gameState === "playing" && (
          <div className="absolute inset-0 pointer-events-none md:hidden">
            <Button
              size="lg"
              variant="outline"
              className="absolute bottom-6 right-6 w-20 h-20 rounded-full bg-red-500/20 border-red-400/40 text-white text-base font-bold active:bg-red-500/40 pointer-events-auto backdrop-blur-sm"
              onTouchStart={(e) => { e.preventDefault(); gameRef.current.keys.up = true; }}
              onTouchEnd={(e) => { e.preventDefault(); gameRef.current.keys.up = false; }}
              onTouchCancel={(e) => { e.preventDefault(); gameRef.current.keys.up = false; }}
              onMouseDown={() => { gameRef.current.keys.up = true; }}
              onMouseUp={() => { gameRef.current.keys.up = false; }}
              onMouseLeave={() => { gameRef.current.keys.up = false; }}
              data-testid="button-mobile-jump"
            >
              JUMP
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="absolute bottom-6 left-6 w-20 h-20 rounded-full bg-orange-500/20 border-orange-400/40 text-white text-base font-bold active:bg-orange-500/40 pointer-events-auto backdrop-blur-sm"
              onTouchStart={(e) => { e.preventDefault(); gameRef.current.keys.down = true; }}
              onTouchEnd={(e) => { e.preventDefault(); gameRef.current.keys.down = false; }}
              onTouchCancel={(e) => { e.preventDefault(); gameRef.current.keys.down = false; }}
              onMouseDown={() => { gameRef.current.keys.down = true; }}
              onMouseUp={() => { gameRef.current.keys.down = false; }}
              onMouseLeave={() => { gameRef.current.keys.down = false; }}
              data-testid="button-mobile-slide"
            >
              SLIDE
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
