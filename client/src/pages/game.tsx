import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Play, RotateCcw, Pause, Volume2, VolumeX, Trophy, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { HighScore } from "@shared/schema";

type GameState = "start" | "playing" | "paused" | "gameover";

interface Obstacle {
  x: number;
  type: "spike" | "log" | "gap" | "ramp";
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
const POLICE_SPEED = 5;
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;

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
    keys: { up: false, down: false, left: false, right: false },
    worldX: 0,
    nextTerrainX: 0,
    lastObstacleX: 0,
    lastVineX: 0,
    lastCoinX: 0,
    vineSwingTime: 0,
    vineGrabCooldown: 0,
  });

  const getTerrainHeight = useCallback((worldX: number): number => {
    const game = gameRef.current;
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
      submitScoreMutation.mutate({
        playerName,
        score: finalScore,
        distance: finalDistance,
        coins: finalCoins,
      });
    }
    
    setGameState("gameover");
  }, [highScore, playerName, submitScoreMutation]);

  const spawnObstacle = useCallback((worldX: number) => {
    const game = gameRef.current;
    const types: Obstacle["type"][] = ["spike", "log", "gap", "ramp"];
    const type = types[Math.floor(Math.random() * types.length)];
    
    let width = 60;
    let height = 40;
    
    switch (type) {
      case "spike":
        width = 30;
        height = 40;
        break;
      case "log":
        width = 80;
        height = 35;
        break;
      case "gap":
        width = 120;
        height = 300;
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
  }, []);

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
      if (e.key === "ArrowLeft" || e.key === "a") {
        game.keys.left = true;
      }
      if (e.key === "ArrowRight" || e.key === "d") {
        game.keys.right = true;
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
      if (e.key === "ArrowLeft" || e.key === "a") {
        game.keys.left = false;
      }
      if (e.key === "ArrowRight" || e.key === "d") {
        game.keys.right = false;
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

    const drawBackground = () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "#87CEEB");
      gradient.addColorStop(0.4, "#E0F0FF");
      gradient.addColorStop(1, "#B0C4DE");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#708090";
      for (let i = 0; i < 6; i++) {
        const x = ((i * 200 - game.cameraX * 0.1) % (canvas.width + 400)) - 200;
        const height = 80 + (i % 3) * 40;
        ctx.beginPath();
        ctx.moveTo(x, canvas.height - 150);
        ctx.lineTo(x + 60, canvas.height - 150 - height);
        ctx.lineTo(x + 100, canvas.height - 150 - height + 20);
        ctx.lineTo(x + 140, canvas.height - 150 - height - 10);
        ctx.lineTo(x + 200, canvas.height - 150);
        ctx.fill();
      }

      ctx.fillStyle = "#228B22";
      for (let i = 0; i < 15; i++) {
        const x = ((i * 100 - game.cameraX * 0.3) % (canvas.width + 200)) - 100;
        const height = 40 + (i % 4) * 20;
        ctx.beginPath();
        ctx.ellipse(x + 50, canvas.height - 100, 35, height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawTerrain = () => {
      const visibleStart = game.cameraX - 100;
      const visibleEnd = game.cameraX + canvas.width + 100;

      ctx.fillStyle = "#3d2817";
      ctx.beginPath();
      
      let started = false;
      for (const segment of game.terrain) {
        if (segment.endX < visibleStart) continue;
        if (segment.startX > visibleEnd) break;

        const screenStartX = segment.startX - game.cameraX;
        const screenEndX = segment.endX - game.cameraX;

        if (!started) {
          ctx.moveTo(screenStartX, segment.startY);
          started = true;
        }
        ctx.lineTo(screenEndX, segment.endY);
      }
      
      ctx.lineTo(canvas.width + 100, canvas.height);
      ctx.lineTo(-100, canvas.height);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#2d8a2d";
      ctx.lineWidth = 4;
      ctx.beginPath();
      started = false;
      for (const segment of game.terrain) {
        if (segment.endX < visibleStart) continue;
        if (segment.startX > visibleEnd) break;

        const screenStartX = segment.startX - game.cameraX;
        const screenEndX = segment.endX - game.cameraX;

        if (!started) {
          ctx.moveTo(screenStartX, segment.startY);
          started = true;
        }
        ctx.lineTo(screenEndX, segment.endY);
      }
      ctx.stroke();
    };

    const drawPlayer = () => {
      const p = game.player;
      const screenX = p.x - game.cameraX;
      
      ctx.save();
      
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
      
      if (screenX > -100) {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(screenX, BASE_GROUND_Y - 40, 80, 30);
        
        ctx.fillStyle = "#2563eb";
        ctx.fillRect(screenX + 10, BASE_GROUND_Y - 55, 60, 15);
        
        const lightOn = Math.floor(game.frameCount / 10) % 2 === 0;
        ctx.fillStyle = lightOn ? "#ef4444" : "#3b82f6";
        ctx.beginPath();
        ctx.arc(screenX + 25, BASE_GROUND_Y - 60, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = lightOn ? "#3b82f6" : "#ef4444";
        ctx.beginPath();
        ctx.arc(screenX + 55, BASE_GROUND_Y - 60, 6, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = "#1a1a1a";
        ctx.beginPath();
        ctx.arc(screenX + 15, BASE_GROUND_Y - 5, 10, 0, Math.PI * 2);
        ctx.arc(screenX + 65, BASE_GROUND_Y - 5, 10, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = "#87CEEB";
        ctx.fillRect(screenX + 15, BASE_GROUND_Y - 50, 20, 12);
        ctx.fillRect(screenX + 45, BASE_GROUND_Y - 50, 20, 12);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText("POLICE", screenX + 40, BASE_GROUND_Y - 25);
      }
    };

    const drawObstacle = (obs: Obstacle) => {
      const screenX = obs.x - game.cameraX;
      const groundY = getTerrainHeight(obs.x + obs.width / 2);
      
      ctx.save();
      
      switch (obs.type) {
        case "spike":
          const spikeGradient = ctx.createLinearGradient(screenX, groundY, screenX, groundY - obs.height);
          spikeGradient.addColorStop(0, "#757575");
          spikeGradient.addColorStop(1, "#bdbdbd");
          ctx.fillStyle = spikeGradient;
          ctx.beginPath();
          ctx.moveTo(screenX, groundY);
          ctx.lineTo(screenX + obs.width / 2, groundY - obs.height);
          ctx.lineTo(screenX + obs.width, groundY);
          ctx.closePath();
          ctx.fill();
          break;
          
        case "log":
          ctx.fillStyle = "#5d4037";
          ctx.beginPath();
          ctx.ellipse(screenX + obs.width / 2, groundY - obs.height / 2, obs.width / 2, obs.height / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#8d6e63";
          ctx.beginPath();
          ctx.ellipse(screenX + obs.width / 2 - 5, groundY - obs.height / 2, obs.width / 2 - 8, obs.height / 2 - 5, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
          
        case "gap":
          ctx.fillStyle = "#0a0a0a";
          ctx.fillRect(screenX, groundY, obs.width, obs.height);
          ctx.fillStyle = "#3e2723";
          ctx.fillRect(screenX - 5, groundY, 5, 20);
          ctx.fillRect(screenX + obs.width, groundY, 5, 20);
          break;
          
        case "ramp":
          const rampGradient = ctx.createLinearGradient(screenX, groundY, screenX + obs.width, groundY - obs.height);
          rampGradient.addColorStop(0, "#795548");
          rampGradient.addColorStop(1, "#a1887f");
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
      game.particles.forEach(p => {
        const screenX = p.x - game.cameraX;
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(screenX, p.y, 4 * p.life, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
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
          
        case "log":
          const logCenterX = obs.x + obs.width / 2;
          const logCenterY = groundY - obs.height / 2;
          const playerCenterX = player.x + player.width / 2;
          const playerCenterY = player.y + (player.state === "sliding" ? SLIDE_HEIGHT : player.height) / 2;
          const dx = playerCenterX - logCenterX;
          const dy = playerCenterY - logCenterY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          return distance < (obs.width / 2 + player.width / 3);
          
        case "gap":
          const playerCenterXGap = player.x + player.width / 2;
          const gapLeft = obs.x + 30;
          const gapRight = obs.x + obs.width - 30;
          
          if (playerCenterXGap > gapLeft && playerCenterXGap < gapRight) {
            const leftEdgeGround = getTerrainHeight(obs.x - 10);
            const rightEdgeGround = getTerrainHeight(obs.x + obs.width + 10);
            const lowestEdge = Math.max(leftEdgeGround, rightEdgeGround);
            
            if (pBottom >= lowestEdge + 150) {
              return true;
            }
          }
          return false;
          
        case "ramp":
          return false;
      }
      return false;
    };

    const update = () => {
      const p = game.player;
      game.frameCount++;

      if (game.frameCount % 60 === 0 && game.police.speed < p.vx + 2) {
        game.police.speed += 0.02;
      }

      game.distanceTraveled += p.vx * 0.1;
      game.scoreValue = Math.floor(game.distanceTraveled * 10) + game.coinsCollected * 100;

      if (p.invincible > 0) p.invincible--;

      game.police.x += game.police.speed;

      const policeDistance = p.x - game.police.x;
      if (policeDistance < 150) {
        setPoliceWarning(Math.min(100, (150 - policeDistance) / 150 * 100));
      } else {
        setPoliceWarning(0);
      }

      if (game.police.x + 80 >= p.x) {
        createParticles(p.x, p.y + p.height / 2, "#ef4444", 15);
        gameOver();
        return;
      }

      if (p.state === "swinging" && p.onVine) {
        const vine = p.onVine;
        
        const gravity = 0.002;
        vine.angularVelocity += -gravity * Math.sin(vine.angle);
        vine.angularVelocity *= 0.998;
        vine.angle += vine.angularVelocity;

        const vineScreenX = vine.x;
        p.x = vineScreenX + Math.sin(vine.angle) * vine.length - p.width / 2;
        p.y = vine.anchorY + Math.cos(vine.angle) * vine.length - p.height / 2;

        game.vineSwingTime = (game.vineSwingTime || 0) + 1;
        
        if (!game.keys.up && game.vineSwingTime > 10) {
          const releaseSpeed = vine.angularVelocity * vine.length;
          
          const forwardBoost = Math.max(0, Math.cos(vine.angle)) * Math.abs(releaseSpeed) * 2;
          p.vx = PLAYER_BASE_SPEED + forwardBoost + 4;
          p.vy = -Math.abs(Math.sin(vine.angle) * releaseSpeed) * 1.5 - 8;
          
          p.vx = Math.max(PLAYER_BASE_SPEED + 2, Math.min(p.vx, PLAYER_BASE_SPEED * 4));
          
          p.state = "jumping";
          p.onVine = null;
          game.vineSwingTime = 0;
          createParticles(p.x + p.width / 2, p.y + p.height / 2, "#4caf50", 10);
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
        }

        p.vy += GRAVITY;
        p.y += p.vy;
        p.x += p.vx;

        let onRamp = false;
        let overGap = false;
        
        game.obstacles.forEach(obs => {
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
            if (playerCenterX > obs.x + 10 && playerCenterX < obs.x + obs.width - 10) {
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
          }
        }
      });
      game.coinsList = game.coinsList.filter(c => c.x > game.cameraX - 50);

      game.particles = game.particles.filter(particle => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.2;
        particle.life -= 0.02;
        return particle.life > 0;
      });

      game.cameraX = p.x - CANVAS_WIDTH / 3;

      const spawnX = game.cameraX + CANVAS_WIDTH + 200;
      
      if (spawnX - game.lastObstacleX > 300 + Math.random() * 200) {
        spawnObstacle(spawnX);
      }
      
      if (spawnX - game.lastVineX > 500 + Math.random() * 300) {
        spawnVine(spawnX);
      }
      
      if (spawnX - game.lastCoinX > 100 + Math.random() * 100) {
        const groundY = getTerrainHeight(spawnX);
        spawnCoin(spawnX, groundY);
      }

      if (game.nextTerrainX < spawnX + 500) {
        generateTerrain(game.nextTerrainX, 10);
      }

      game.terrain = game.terrain.filter(seg => seg.endX > game.cameraX - 200);

      setScore(game.scoreValue);
      setDistance(Math.floor(game.distanceTraveled));
      setCoins(game.coinsCollected);
    };

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      drawBackground();
      
      game.vines.forEach(drawVine);
      
      drawTerrain();
      
      game.obstacles.forEach(drawObstacle);
      game.coinsList.forEach(drawCoin);
      
      drawPolice();
      drawPlayer();
      
      drawParticles();
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
          <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between pointer-events-none">
            <div className="flex flex-col gap-1">
              <div className="text-2xl font-bold text-white drop-shadow-lg" data-testid="text-score">
                Score: {score.toLocaleString()}
              </div>
              <div className="text-lg text-white/80 drop-shadow-md" data-testid="text-coins">
                Coins: {coins}
              </div>
            </div>
            <div className="text-xl font-semibold text-white drop-shadow-lg" data-testid="text-distance">
              {distance}m
            </div>
            <div className="flex gap-2 pointer-events-auto">
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
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-8 pointer-events-auto md:hidden">
            <Button
              size="lg"
              variant="outline"
              className="w-24 h-24 rounded-full bg-red-500/30 border-red-400/50 text-white text-lg font-bold active:bg-red-500/50"
              onTouchStart={(e) => { e.preventDefault(); gameRef.current.keys.up = true; }}
              onTouchEnd={(e) => { e.preventDefault(); gameRef.current.keys.up = false; }}
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
              className="w-24 h-24 rounded-full bg-orange-500/30 border-orange-400/50 text-white text-lg font-bold active:bg-orange-500/50"
              onTouchStart={(e) => { e.preventDefault(); gameRef.current.keys.down = true; }}
              onTouchEnd={(e) => { e.preventDefault(); gameRef.current.keys.down = false; }}
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
