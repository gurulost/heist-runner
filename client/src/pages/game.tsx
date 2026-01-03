import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Play, RotateCcw, Pause, Volume2, VolumeX, Trophy } from "lucide-react";
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
  swingDirection: 1 | -1;
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

interface Player {
  x: number;
  y: number;
  vy: number;
  width: number;
  height: number;
  state: "running" | "jumping" | "sliding" | "swinging" | "falling";
  animFrame: number;
  onVine: Vine | null;
  vineProgress: number;
  invincible: number;
}

const GRAVITY = 0.6;
const JUMP_FORCE = -14;
const GROUND_Y = 350;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 50;
const SLIDE_HEIGHT = 25;
const GAME_SPEED_BASE = 6;
const GAME_SPEED_INCREMENT = 0.0005;

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
      x: 100,
      y: GROUND_Y - PLAYER_HEIGHT,
      vy: 0,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      state: "running" as Player["state"],
      animFrame: 0,
      onVine: null as Vine | null,
      vineProgress: 0,
      invincible: 0,
    },
    obstacles: [] as Obstacle[],
    vines: [] as Vine[],
    coinsList: [] as Coin[],
    particles: [] as Particle[],
    gameSpeed: GAME_SPEED_BASE,
    distanceTraveled: 0,
    scoreValue: 0,
    coinsCollected: 0,
    frameCount: 0,
    keys: { up: false, down: false, left: false, right: false },
    backgroundOffset: 0,
    midgroundOffset: 0,
    foregroundOffset: 0,
    groundOffset: 0,
  });

  const resetGame = useCallback(() => {
    const game = gameRef.current;
    game.player = {
      x: 100,
      y: GROUND_Y - PLAYER_HEIGHT,
      vy: 0,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      state: "running",
      animFrame: 0,
      onVine: null,
      vineProgress: 0,
      invincible: 0,
    };
    game.obstacles = [];
    game.vines = [];
    game.coinsList = [];
    game.particles = [];
    game.gameSpeed = GAME_SPEED_BASE;
    game.distanceTraveled = 0;
    game.scoreValue = 0;
    game.coinsCollected = 0;
    game.frameCount = 0;
    game.backgroundOffset = 0;
    game.midgroundOffset = 0;
    game.foregroundOffset = 0;
    game.groundOffset = 0;
    setScore(0);
    setDistance(0);
    setCoins(0);
  }, []);

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

  const spawnObstacle = useCallback((canvasWidth: number) => {
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
        width = 100;
        height = 200;
        break;
      case "ramp":
        width = 120;
        height = 50;
        break;
    }
    
    game.obstacles.push({
      x: canvasWidth + 100,
      type,
      width,
      height,
      passed: false,
    });
  }, []);

  const spawnVine = useCallback((canvasWidth: number) => {
    const game = gameRef.current;
    game.vines.push({
      x: canvasWidth + 100,
      anchorY: 0,
      length: 150 + Math.random() * 100,
      angle: -Math.PI / 6,
      swingDirection: 1,
    });
  }, []);

  const spawnCoin = useCallback((canvasWidth: number) => {
    const game = gameRef.current;
    const yPositions = [GROUND_Y - 100, GROUND_Y - 150, GROUND_Y - 200];
    game.coinsList.push({
      x: canvasWidth + 50 + Math.random() * 200,
      y: yPositions[Math.floor(Math.random() * yPositions.length)],
      collected: false,
      rotation: 0,
    });
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
      gradient.addColorStop(0, "#1a1a2e");
      gradient.addColorStop(0.5, "#16213e");
      gradient.addColorStop(1, "#0f3460");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      for (let i = 0; i < 50; i++) {
        const x = ((i * 73 + game.backgroundOffset * 0.1) % (canvas.width + 20)) - 10;
        const y = (i * 37) % (canvas.height * 0.6);
        const size = (i % 3) + 1;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "rgba(34, 87, 122, 0.4)";
      for (let i = 0; i < 8; i++) {
        const x = ((i * 150 - game.backgroundOffset * 0.2) % (canvas.width + 300)) - 150;
        const height = 100 + (i % 3) * 50;
        ctx.beginPath();
        ctx.moveTo(x, canvas.height - 100);
        ctx.lineTo(x + 75, canvas.height - 100 - height);
        ctx.lineTo(x + 150, canvas.height - 100);
        ctx.fill();
      }

      ctx.fillStyle = "rgba(46, 125, 50, 0.3)";
      for (let i = 0; i < 12; i++) {
        const x = ((i * 100 - game.midgroundOffset * 0.5) % (canvas.width + 200)) - 100;
        const height = 60 + (i % 4) * 30;
        ctx.beginPath();
        ctx.ellipse(x + 50, canvas.height - 80, 40, height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "rgba(27, 94, 32, 0.5)";
      for (let i = 0; i < 15; i++) {
        const x = ((i * 80 - game.foregroundOffset * 0.8) % (canvas.width + 160)) - 80;
        const height = 40 + (i % 3) * 20;
        ctx.beginPath();
        ctx.ellipse(x + 40, canvas.height - 60, 30, height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawGround = () => {
      const groundGradient = ctx.createLinearGradient(0, GROUND_Y, 0, canvas.height);
      groundGradient.addColorStop(0, "#4a2c2a");
      groundGradient.addColorStop(0.3, "#3e2723");
      groundGradient.addColorStop(1, "#1b0f0e");
      ctx.fillStyle = groundGradient;
      ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

      ctx.fillStyle = "#5d4037";
      ctx.fillRect(0, GROUND_Y, canvas.width, 8);

      ctx.fillStyle = "#2e7d32";
      for (let i = 0; i < canvas.width / 15; i++) {
        const x = ((i * 15 - game.groundOffset) % canvas.width);
        const height = 8 + Math.sin(i * 0.5) * 4;
        ctx.beginPath();
        ctx.moveTo(x, GROUND_Y);
        ctx.lineTo(x + 4, GROUND_Y - height);
        ctx.lineTo(x + 8, GROUND_Y);
        ctx.fill();
      }
    };

    const drawPlayer = () => {
      const p = game.player;
      ctx.save();
      
      if (p.invincible > 0 && Math.floor(game.frameCount / 5) % 2 === 0) {
        ctx.globalAlpha = 0.5;
      }

      const bodyColor = "#e53935";
      const skinColor = "#ffccbc";
      const hairColor = "#3e2723";

      if (p.state === "swinging" && p.onVine) {
        ctx.translate(p.x + p.width / 2, p.y + p.height / 2);
        ctx.rotate(p.onVine.angle * 0.3);
        ctx.translate(-(p.x + p.width / 2), -(p.y + p.height / 2));
      }

      if (p.state === "sliding") {
        ctx.fillStyle = bodyColor;
        ctx.fillRect(p.x, p.y + p.height - SLIDE_HEIGHT, p.width + 10, SLIDE_HEIGHT - 5);
        
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.arc(p.x + p.width + 5, p.y + p.height - SLIDE_HEIGHT / 2, 10, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hairColor;
        ctx.beginPath();
        ctx.arc(p.x + p.width + 5, p.y + p.height - SLIDE_HEIGHT / 2 - 5, 8, Math.PI, 0);
        ctx.fill();
      } else {
        ctx.fillStyle = bodyColor;
        const bounce = p.state === "running" ? Math.sin(game.frameCount * 0.3) * 2 : 0;
        ctx.fillRect(p.x + 5, p.y + 20 + bounce, p.width - 10, p.height - 35);

        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.arc(p.x + p.width / 2, p.y + 12 + bounce, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hairColor;
        ctx.beginPath();
        ctx.arc(p.x + p.width / 2, p.y + 8 + bounce, 10, Math.PI, 0);
        ctx.fill();

        ctx.fillStyle = "#1565c0";
        ctx.fillRect(p.x + 8, p.y + p.height - 15, 10, 15);
        ctx.fillRect(p.x + p.width - 18, p.y + p.height - 15, 10, 15);

        if (p.state === "running") {
          const legOffset = Math.sin(game.frameCount * 0.4) * 5;
          ctx.fillRect(p.x + 8 + legOffset, p.y + p.height - 15, 10, 15);
          ctx.fillRect(p.x + p.width - 18 - legOffset, p.y + p.height - 15, 10, 15);
        }

        if (p.state === "jumping" || p.state === "falling") {
          ctx.fillStyle = skinColor;
          ctx.fillRect(p.x - 5, p.y + 25, 10, 5);
          ctx.fillRect(p.x + p.width - 5, p.y + 25, 10, 5);
        } else if (p.state === "swinging") {
          ctx.fillStyle = skinColor;
          ctx.fillRect(p.x + p.width / 2 - 3, p.y - 10, 6, 15);
        }
      }

      ctx.restore();
    };

    const drawObstacle = (obs: Obstacle) => {
      ctx.save();
      
      switch (obs.type) {
        case "spike":
          const spikeGradient = ctx.createLinearGradient(obs.x, GROUND_Y, obs.x, GROUND_Y - obs.height);
          spikeGradient.addColorStop(0, "#757575");
          spikeGradient.addColorStop(1, "#bdbdbd");
          ctx.fillStyle = spikeGradient;
          ctx.beginPath();
          ctx.moveTo(obs.x, GROUND_Y);
          ctx.lineTo(obs.x + obs.width / 2, GROUND_Y - obs.height);
          ctx.lineTo(obs.x + obs.width, GROUND_Y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "#424242";
          ctx.lineWidth = 2;
          ctx.stroke();
          break;
          
        case "log":
          ctx.fillStyle = "#5d4037";
          ctx.beginPath();
          ctx.ellipse(obs.x + obs.width / 2, GROUND_Y - obs.height / 2, obs.width / 2, obs.height / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#8d6e63";
          ctx.beginPath();
          ctx.ellipse(obs.x + obs.width / 2 - 5, GROUND_Y - obs.height / 2, obs.width / 2 - 8, obs.height / 2 - 5, 0, 0, Math.PI * 2);
          ctx.fill();
          for (let i = 0; i < 3; i++) {
            ctx.strokeStyle = "#4e342e";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(obs.x + obs.width / 2 - 5, GROUND_Y - obs.height / 2, 5 + i * 8, 0, Math.PI * 2);
            ctx.stroke();
          }
          break;
          
        case "gap":
          ctx.fillStyle = "#0d0d0d";
          ctx.fillRect(obs.x, GROUND_Y, obs.width, obs.height);
          ctx.fillStyle = "#3e2723";
          ctx.fillRect(obs.x - 5, GROUND_Y, 5, 20);
          ctx.fillRect(obs.x + obs.width, GROUND_Y, 5, 20);
          break;
          
        case "ramp":
          const rampGradient = ctx.createLinearGradient(obs.x, GROUND_Y, obs.x + obs.width, GROUND_Y - obs.height);
          rampGradient.addColorStop(0, "#795548");
          rampGradient.addColorStop(1, "#a1887f");
          ctx.fillStyle = rampGradient;
          ctx.beginPath();
          ctx.moveTo(obs.x, GROUND_Y);
          ctx.lineTo(obs.x + obs.width, GROUND_Y - obs.height);
          ctx.lineTo(obs.x + obs.width, GROUND_Y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "#5d4037";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(obs.x, GROUND_Y);
          ctx.lineTo(obs.x + obs.width, GROUND_Y - obs.height);
          ctx.stroke();
          break;
      }
      
      ctx.restore();
    };

    const drawVine = (vine: Vine) => {
      const endX = vine.x + Math.sin(vine.angle) * vine.length;
      const endY = vine.anchorY + Math.cos(vine.angle) * vine.length;

      ctx.strokeStyle = "#2e7d32";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(vine.x, vine.anchorY);
      
      const cp1x = vine.x + Math.sin(vine.angle * 0.5) * vine.length * 0.3;
      const cp1y = vine.anchorY + vine.length * 0.3;
      const cp2x = vine.x + Math.sin(vine.angle * 0.8) * vine.length * 0.7;
      const cp2y = vine.anchorY + vine.length * 0.7;
      
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
      ctx.stroke();

      ctx.strokeStyle = "#1b5e20";
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = "#4caf50";
      for (let i = 0; i < 5; i++) {
        const t = (i + 1) / 6;
        const leafX = vine.x + Math.sin(vine.angle * t) * vine.length * t;
        const leafY = vine.anchorY + vine.length * t;
        ctx.beginPath();
        ctx.ellipse(leafX + 8, leafY, 6, 3, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "#8d6e63";
      ctx.beginPath();
      ctx.arc(vine.x, vine.anchorY, 8, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawCoin = (coin: Coin) => {
      if (coin.collected) return;
      
      ctx.save();
      ctx.translate(coin.x, coin.y);
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
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 * p.life, 0, Math.PI * 2);
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

      switch (obs.type) {
        case "spike":
          const spikeLeft = obs.x + 5;
          const spikeRight = obs.x + obs.width - 5;
          const spikeTop = GROUND_Y - obs.height;
          const spikeBottom = GROUND_Y;
          return pRight > spikeLeft && pLeft < spikeRight && pBottom > spikeTop && pTop < spikeBottom;
          
        case "log":
          const logCenterX = obs.x + obs.width / 2;
          const logCenterY = GROUND_Y - obs.height / 2;
          const playerCenterX = player.x + player.width / 2;
          const playerCenterY = player.y + (player.state === "sliding" ? SLIDE_HEIGHT : player.height) / 2;
          const dx = playerCenterX - logCenterX;
          const dy = playerCenterY - logCenterY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          return distance < (obs.width / 2 + player.width / 3);
          
        case "gap":
          if (pBottom >= GROUND_Y - 5 && pRight > obs.x + 10 && pLeft < obs.x + obs.width - 10) {
            return true;
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

      game.gameSpeed = GAME_SPEED_BASE + game.distanceTraveled * GAME_SPEED_INCREMENT;
      game.distanceTraveled += game.gameSpeed * 0.1;
      game.scoreValue = Math.floor(game.distanceTraveled * 10) + game.coinsCollected * 100;

      game.backgroundOffset += game.gameSpeed;
      game.midgroundOffset += game.gameSpeed;
      game.foregroundOffset += game.gameSpeed;
      game.groundOffset += game.gameSpeed;

      if (p.invincible > 0) p.invincible--;

      if (p.state === "swinging" && p.onVine) {
        const vine = p.onVine;
        vine.angle += vine.swingDirection * 0.03;
        
        if (vine.angle > Math.PI / 3) vine.swingDirection = -1;
        if (vine.angle < -Math.PI / 3) vine.swingDirection = 1;

        p.x = vine.x + Math.sin(vine.angle) * vine.length - p.width / 2;
        p.y = vine.anchorY + Math.cos(vine.angle) * vine.length - p.height / 2;

        if (game.keys.up) {
          p.state = "jumping";
          p.vy = JUMP_FORCE * 0.8;
          p.onVine = null;
          createParticles(p.x + p.width / 2, p.y + p.height / 2, "#4caf50", 5);
        }
      } else {
        if (game.keys.down && p.y >= GROUND_Y - PLAYER_HEIGHT - 5 && p.state !== "jumping") {
          p.state = "sliding";
          p.height = SLIDE_HEIGHT;
        } else if (!game.keys.down && p.state === "sliding") {
          p.state = "running";
          p.height = PLAYER_HEIGHT;
          p.y = GROUND_Y - PLAYER_HEIGHT;
        }

        if (game.keys.up && p.y >= GROUND_Y - PLAYER_HEIGHT - 5 && p.state !== "swinging") {
          p.vy = JUMP_FORCE;
          p.state = "jumping";
          createParticles(p.x + p.width / 2, p.y + p.height, "#8d6e63", 3);
        }

        p.vy += GRAVITY;
        p.y += p.vy;

        let onRamp = false;
        game.obstacles.forEach(obs => {
          if (obs.type === "ramp") {
            const rampProgress = (p.x + p.width / 2 - obs.x) / obs.width;
            if (rampProgress > 0 && rampProgress < 1) {
              const rampY = GROUND_Y - (rampProgress * obs.height);
              if (p.y + p.height > rampY && p.vy >= 0) {
                p.y = rampY - p.height;
                p.vy = 0;
                onRamp = true;
                if (game.keys.down) {
                  p.vy = -5;
                  game.gameSpeed += 2;
                }
              }
            }
          }
        });

        if (!onRamp && p.y >= GROUND_Y - (p.state === "sliding" ? SLIDE_HEIGHT : PLAYER_HEIGHT)) {
          p.y = GROUND_Y - (p.state === "sliding" ? SLIDE_HEIGHT : PLAYER_HEIGHT);
          p.vy = 0;
          if (p.state === "jumping" || p.state === "falling") {
            p.state = game.keys.down ? "sliding" : "running";
            createParticles(p.x + p.width / 2, p.y + p.height, "#8d6e63", 2);
          }
        } else if (p.y < GROUND_Y - PLAYER_HEIGHT && p.state !== "jumping") {
          p.state = "falling";
        }
      }

      game.vines.forEach(vine => {
        if (p.state !== "swinging") {
          const vineEndX = vine.x + Math.sin(vine.angle) * vine.length;
          const vineEndY = vine.anchorY + Math.cos(vine.angle) * vine.length;
          
          const dx = (p.x + p.width / 2) - vineEndX;
          const dy = (p.y) - vineEndY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < 40 && game.keys.up) {
            p.state = "swinging";
            p.onVine = vine;
            p.vy = 0;
          }
        }
      });

      game.obstacles = game.obstacles.filter(obs => {
        obs.x -= game.gameSpeed;
        
        if (checkCollision(p, obs)) {
          createParticles(p.x + p.width / 2, p.y + p.height / 2, "#e53935", 10);
          gameOver();
          return false;
        }
        
        return obs.x > -obs.width - 50;
      });

      game.vines = game.vines.filter(vine => {
        vine.x -= game.gameSpeed;
        return vine.x > -100;
      });

      game.coinsList.forEach(coin => {
        coin.x -= game.gameSpeed;
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
      game.coinsList = game.coinsList.filter(c => c.x > -30);

      game.particles = game.particles.filter(particle => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.2;
        particle.life -= 0.02;
        return particle.life > 0;
      });

      if (game.frameCount % 120 === 0 && Math.random() > 0.3) {
        spawnObstacle(canvas.width);
      }
      if (game.frameCount % 200 === 0 && Math.random() > 0.5) {
        spawnVine(canvas.width);
      }
      if (game.frameCount % 60 === 0 && Math.random() > 0.4) {
        spawnCoin(canvas.width);
      }

      setScore(game.scoreValue);
      setDistance(Math.floor(game.distanceTraveled));
      setCoins(game.coinsCollected);
    };

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      drawBackground();
      
      game.vines.forEach(drawVine);
      
      drawGround();
      
      game.obstacles.forEach(drawObstacle);
      game.coinsList.forEach(drawCoin);
      
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
  }, [gameState, gameOver, spawnObstacle, spawnVine, spawnCoin, createParticles]);

  useEffect(() => {
    if (gameState !== "start" && gameState !== "gameover" && gameState !== "paused") return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const game = gameRef.current;

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

      ctx.fillStyle = "rgba(34, 87, 122, 0.5)";
      for (let i = 0; i < 6; i++) {
        const x = i * 180 - 50;
        const height = 120 + (i % 3) * 60;
        ctx.beginPath();
        ctx.moveTo(x, canvas.height - 80);
        ctx.lineTo(x + 90, canvas.height - 80 - height);
        ctx.lineTo(x + 180, canvas.height - 80);
        ctx.fill();
      }

      const groundGradient = ctx.createLinearGradient(0, GROUND_Y, 0, canvas.height);
      groundGradient.addColorStop(0, "#4a2c2a");
      groundGradient.addColorStop(0.3, "#3e2723");
      groundGradient.addColorStop(1, "#1b0f0e");
      ctx.fillStyle = groundGradient;
      ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);
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

        {gameState === "playing" && (
          <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
            <div className="text-sm text-white/60 drop-shadow">
              Press UP to jump | DOWN to slide | Grab vines!
            </div>
          </div>
        )}

        {gameState === "start" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 rounded-lg overflow-y-auto py-8">
            <h1 
              className="text-4xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-green-300 to-teal-400 mb-2 md:mb-4 animate-pulse"
              style={{ fontFamily: "'Poppins', sans-serif" }}
              data-testid="text-game-title"
            >
              JUNGLE RUNNER
            </h1>
            <p className="text-lg md:text-xl text-white/80 mb-2">Endless Adventure Awaits!</p>
            
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
              className="px-12 py-6 text-xl font-bold rounded-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-lg shadow-emerald-500/30 transition-all duration-300"
              data-testid="button-play"
            >
              <Play className="w-6 h-6 mr-2" />
              Play Game
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
                Grab vines and swing to safety!
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
                className="px-10 py-5 text-lg font-semibold rounded-full bg-gradient-to-r from-emerald-500 to-green-600"
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
              GAME OVER
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
                <div className="text-sm text-white/60">Coins</div>
              </Card>
              <Card className="p-4 bg-white/10 border-white/20 text-center">
                <div className="text-2xl font-bold text-emerald-400">{highScore.toLocaleString()}</div>
                <div className="text-sm text-white/60">Best</div>
              </Card>
            </div>
            <div className="flex gap-4">
              <Button
                size="lg"
                onClick={startGame}
                className="px-10 py-5 text-lg font-semibold rounded-full bg-gradient-to-r from-emerald-500 to-green-600"
                data-testid="button-play-again"
              >
                <RotateCcw className="w-5 h-5 mr-2" />
                Play Again
              </Button>
            </div>
          </div>
        )}

        {gameState === "playing" && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-8 pointer-events-auto md:hidden">
            <Button
              size="lg"
              variant="outline"
              className="w-24 h-24 rounded-full bg-emerald-500/30 border-emerald-400/50 text-white text-lg font-bold active:bg-emerald-500/50"
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
              className="w-24 h-24 rounded-full bg-amber-500/30 border-amber-400/50 text-white text-lg font-bold active:bg-amber-500/50"
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
