import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Play, RotateCcw, Pause, Volume2, VolumeX, Trophy, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSound } from "@/hooks/useSound";
import type { HighScore } from "@shared/schema";

type GameState = "start" | "playing" | "paused" | "gameover" | "victory";

interface Obstacle {
  x: number;
  type: "spike" | "mushroom" | "gap" | "ramp" | "low_beam" | "warning";
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
  vineLength: number;
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
const GAP_FLATTEN_RANGE = 120;
const VINE_WALL_BUFFER = 220;
const VINE_SPIKE_BUFFER = 260;
const VINE_GRAB_RADIUS = 70;
const GLIDE_CHARGE_DISTANCE = 500;
const GLIDE_CHARGE_SECONDS = 0.5;
const GLIDE_MAX_DISPLAY_SECONDS = 3;
const VICTORY_DISTANCE = 20000;
const CHECKPOINT_DISTANCE = 10000;

type CharacterStyle = "classic" | "ninja" | "clown" | "gold" | "neon";

interface CharacterConfig {
  name: string;
  stripeColor1: string;
  stripeColor2: string;
  skinColor: string;
  maskColor: string;
  bagColor: string;
  bagSymbol: string;
}

const CHARACTER_STYLES: Record<CharacterStyle, CharacterConfig> = {
  classic: {
    name: "Classic Robber",
    stripeColor1: "#1a1a1a",
    stripeColor2: "#ffffff",
    skinColor: "#ffccbc",
    maskColor: "#1a1a1a",
    bagColor: "#8B4513",
    bagSymbol: "$",
  },
  ninja: {
    name: "Shadow Ninja",
    stripeColor1: "#1e1b4b",
    stripeColor2: "#4c1d95",
    skinColor: "#d4c5a9",
    maskColor: "#0f0a1f",
    bagColor: "#312e81",
    bagSymbol: "*",
  },
  clown: {
    name: "Crazy Clown",
    stripeColor1: "#dc2626",
    stripeColor2: "#facc15",
    skinColor: "#fef3c7",
    maskColor: "#dc2626",
    bagColor: "#7c3aed",
    bagSymbol: "!",
  },
  gold: {
    name: "Gold Digger",
    stripeColor1: "#b45309",
    stripeColor2: "#fbbf24",
    skinColor: "#fef3c7",
    maskColor: "#78350f",
    bagColor: "#f59e0b",
    bagSymbol: "$",
  },
  neon: {
    name: "Neon Runner",
    stripeColor1: "#0ea5e9",
    stripeColor2: "#22d3ee",
    skinColor: "#e0f2fe",
    maskColor: "#0c4a6e",
    bagColor: "#06b6d4",
    bagSymbol: "+",
  },
};

interface Plane {
  x: number;
  y: number;
  vx: number;
  state: "hidden" | "entering" | "waiting" | "departing";
  rotorAngle: number; // For helicopter animation
}

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
  const [checkpointActive, setCheckpointActive] = useState(false);
  const [checkpointUsed, setCheckpointUsed] = useState(false);
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem("playerName") || "Player";
  });
  const [policeWarning, setPoliceWarning] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterStyle>(() => {
    return (localStorage.getItem("selectedCharacter") as CharacterStyle) || "classic";
  });
  const [glideSeconds, setGlideSeconds] = useState(0);
  const [glideChargeProgress, setGlideChargeProgress] = useState(0);

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
      vineLength: 0,
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
    lastDisplayedGlideSeconds: 0,
    lastDisplayedGlideProgress: 0,
    worldX: 0,
    nextTerrainX: 0,
    lastObstacleX: 0,
    lastVineX: 0,
    lastCoinX: 0,
    vineSwingTime: 0,
    vineGrabCooldown: 0,
    glideSeconds: 0,
    glideChargeProgress: 0,
    nextGlideChargeDistance: GLIDE_CHARGE_DISTANCE,
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
    cameraZoom: 1,
    plane: { // Renamed to Helicopter conceptually
      x: CANVAS_WIDTH + 200,
      y: 100,
      vx: 0,
      state: "hidden" as Plane["state"],
      rotorAngle: 0,
    } as Plane,
    checkPointReached: false,
    checkPointUsed: false,
  });

  const getTerrainHeight = useCallback((worldX: number, visuals: boolean = false): number => {
    const game = gameRef.current;
    const gaps = game.obstacles.filter(o => o.type === "gap");

    // Force pits to be lethal (physics sees abyss, visuals see terrain)
    const inGap = gaps.some(o => worldX >= o.x && worldX <= o.x + o.width);
    if (inGap && !visuals) return THE_ABYSS;

    let terrainY = BASE_GROUND_Y;
    for (const segment of game.terrain) {
      if (worldX >= segment.startX && worldX < segment.endX) {
        const t = (worldX - segment.startX) / (segment.endX - segment.startX);
        terrainY = segment.startY + (segment.endY - segment.startY) * t;
        break;
      }
    }

    if (gaps.length > 0) {
      let blend = 0;
      for (const gap of gaps) {
        const leftStart = gap.x - GAP_FLATTEN_RANGE;
        const rightEnd = gap.x + gap.width + GAP_FLATTEN_RANGE;
        if (worldX >= leftStart && worldX < gap.x) {
          const t = (worldX - leftStart) / GAP_FLATTEN_RANGE;
          blend = Math.max(blend, t);
        } else if (worldX > gap.x + gap.width && worldX <= rightEnd) {
          const t = (rightEnd - worldX) / GAP_FLATTEN_RANGE;
          blend = Math.max(blend, t);
        }
      }
      if (blend > 0) {
        terrainY = terrainY * (1 - blend) + BASE_GROUND_Y * blend;
      }
    }

    return terrainY;
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
      vineLength: 0,
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
    game.glideSeconds = 0;
    game.glideChargeProgress = 0;
    game.nextGlideChargeDistance = GLIDE_CHARGE_DISTANCE;
    game.cameraZoom = 1;
    game.plane = { x: -200, y: 100, vx: 0, state: "hidden", rotorAngle: 0 } as Plane;
    game.checkPointReached = false;
    game.checkPointUsed = false;

    generateTerrain(0, 20);

    setScore(0);
    setDistance(0);
    setCoins(0);
    setPoliceWarning(0);
    setCheckpointActive(false);
    setCheckpointUsed(false);
    setGlideSeconds(0);
    setGlideChargeProgress(0);
  }, [generateTerrain]);

  const startGame = useCallback(() => {
    resetGame();
    setGameState("playing");
  }, [resetGame]);

  const togglePause = useCallback(() => {
    setGameState(prev => prev === "playing" ? "paused" : "playing");
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

  const gameOver = useCallback(() => {
    const game = gameRef.current;

    // CHECKPOINT LOGIC
    if (game.checkPointReached && !game.checkPointUsed) {
      // RESPAWN!
      game.checkPointUsed = true;
      setCheckpointUsed(true);

      // Reset player to safe state
      game.player.y = BASE_GROUND_Y - 100;
      game.player.vy = 0;
      game.player.vx = 0; // Stop momentum
      game.player.state = "jumping"; // Fall in gracefully
      game.player.invincible = 120; // 2 seconds safety

      // Push police back
      game.police.x = game.player.x - 600;

      // Visual Feedback
      game.shake = 20;
      createParticles(game.player.x, game.player.y, "#4ade80", 50); // Green Respawn particles
      // Could add a sound here
      return;
    }

    const finalScore = game.scoreValue;
    const finalDistance = Math.floor(game.distanceTraveled);
    const finalCoins = game.coinsCollected;

    setHighScore((prev: number) => {
      if (game.scoreValue > prev) {
        localStorage.setItem("runnerHighScore", game.scoreValue.toString());
        return game.scoreValue;
      }
      return prev;
    });
    const validatedName = playerName.trim() || 'Player';
    submitScoreMutation.mutate({
      playerName: validatedName,
      score: finalScore,
      distance: finalDistance,
      coins: finalCoins,
    });

    setGameState("gameover");
    soundRef.current.playGameOver();
  }, [playerName, submitScoreMutation, createParticles]); // Added createParticles to dependencies

  const spawnVine = useCallback((worldX: number, options: { force?: boolean; length?: number; angle?: number; anchorY?: number } = {}) => {
    const game = gameRef.current;
    const { force = false, length, angle, anchorY } = options;

    if (!force) {
      const inGap = game.obstacles.some(o => o.type === "gap" && worldX >= o.x && worldX <= o.x + o.width);
      if (inGap) return;

      const nearWall = game.obstacles.some(o => o.type === "low_beam" && worldX >= o.x - VINE_WALL_BUFFER && worldX <= o.x + o.width + VINE_WALL_BUFFER);
      if (nearWall) return;

      const nearSpike = game.obstacles.some(o => o.type === "spike" && worldX >= o.x - VINE_SPIKE_BUFFER && worldX <= o.x + o.width + VINE_SPIKE_BUFFER);
      if (nearSpike) return;
    }

    game.vines.push({
      x: worldX,
      anchorY: anchorY ?? 20,
      length: length ?? (180 + Math.random() * 80),
      angle: angle ?? -Math.PI / 4,
      angularVelocity: 0,
    });
    game.lastVineX = worldX;
  }, []);

  const spawnObstacle = useCallback((worldX: number) => {
    const game = gameRef.current;

    // Weighted probabilities for FLOW
    // Spike: 30%, Low Beam: 30%, Gap: 25%, Ramp: 5%, Chasm: 10%
    const rand = Math.random();
    let type: Obstacle["type"] = "spike";

    if (rand < 0.30) type = "spike";
    else if (rand < 0.60) type = "low_beam";
    else if (rand < 0.85) type = "gap"; // Small/Medium Gap
    else if (rand < 0.90) type = "ramp";
    else type = "gap"; // Chasm placeholder (will be handled below)

    // FORCE Chasm logic if we rolled the last 10%
    const isChasm = rand >= 0.90;

    let width = 60;
    let height = 40;

    if (isChasm) {
      // Warning Sign FIRST
      game.obstacles.push({
        x: worldX,
        type: "warning",
        width: 40,
        height: 80, // Tall sign
        passed: false
      });

      // Then the ACTUAL Chasm 500 units later
      const chasmX = worldX + 500;
      width = 800 + Math.random() * 400; // Giant

      game.obstacles.push({
        x: chasmX,
        type: "gap",
        width: width,
        height: 300,
        passed: false
      });

      // Flatten terrain around chasm
      const flattenStart = chasmX - GAP_FLATTEN_RANGE;
      const flattenEnd = chasmX + width + GAP_FLATTEN_RANGE;
      game.terrain.forEach((seg: TerrainSegment) => {
        if (seg.endX > flattenStart && seg.startX < flattenEnd) {
          seg.startY = BASE_GROUND_Y;
          seg.endY = BASE_GROUND_Y;
        }
      });

      const preChasmVineX = chasmX - 140;
      const midChasmVineX = chasmX + width * 0.45;
      spawnVine(preChasmVineX, { force: true, length: 240, angle: -Math.PI / 6 });
      spawnVine(midChasmVineX, { force: true, length: 220, angle: -Math.PI / 10, anchorY: 30 });

      game.lastObstacleX = chasmX + width;
      return; // Done
    }

    let obstacleX = worldX;
    const isNearVine = (buffer: number) => game.vines.some(v => Math.abs(v.x - obstacleX) < buffer);
    if (type === "low_beam" && isNearVine(VINE_WALL_BUFFER)) {
      obstacleX += VINE_WALL_BUFFER;
    }
    if (type === "spike" && isNearVine(VINE_SPIKE_BUFFER)) {
      obstacleX += VINE_SPIKE_BUFFER;
    }

    switch (type) {
      case "spike":
        width = 30;
        height = 40;
        break;
      case "low_beam":
        width = 40; // Thicker wall
        height = CANVAS_HEIGHT; // Full height (visual only, effective height handled in collision)
        break;
      case "gap":
        // Regular Jumpable Gap - SMALLER as requested
        width = 100 + Math.random() * 150; // Was 200+
        height = 300;
        break;
      case "ramp":
        width = 120;
        height = 60;
        break;
    }

    game.obstacles.push({
      x: obstacleX,
      type,
      width,
      height,
      passed: false,
    });

    // Flatten terrain segments around gaps so pits have flat ground on both sides
    if (type === "gap") {
      const flattenStart = obstacleX - GAP_FLATTEN_RANGE;
      const flattenEnd = obstacleX + width + GAP_FLATTEN_RANGE;
      game.terrain.forEach((seg: TerrainSegment) => {
        if (seg.endX > flattenStart && seg.startX < flattenEnd) {
          seg.startY = BASE_GROUND_Y;
          seg.endY = BASE_GROUND_Y;
        }
      });
    }

    game.lastObstacleX = obstacleX + width;
    if (type === "gap") game.lastVineX = obstacleX;

  }, [spawnVine]);

  const spawnCoin = useCallback((worldX: number, groundY: number) => {
    const game = gameRef.current;
    const inGap = game.obstacles.some(o => o.type === "gap" && worldX >= o.x && worldX <= o.x + o.width);
    if (inGap) return;
    const yPositions = [groundY - 80, groundY - 130, groundY - 180];
    game.coinsList.push({
      x: worldX,
      y: yPositions[Math.floor(Math.random() * yPositions.length)],
      collected: false,
      rotation: 0,
    });
    game.lastCoinX = worldX;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === " ") {
        e.preventDefault();
        if (!game.keys.up && game.player.state !== "falling") {
          soundRef.current.playJump();
        }
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
        if (!playerName.trim()) return; // Validation
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
  }, [gameState, togglePause, startGame, playerName]);

  useEffect(() => {
    // Allow loop to continue for victory logic if needed, but we switch state at end
    // Actually, simple: The loop runs while "playing". The cutscene runs while "playing". 
    // At end of cutscene, we switch to "victory". 
    // So "victory" state is just the static screen.
    // So this line is fine as long as we only switch to "victory" AFTER the plane flies away.
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
      const zs = 1 / game.cameraZoom;
      const extW = canvas.width * zs + 100;
      const extH = canvas.height * zs + 100;
      const offX = -((extW - canvas.width) / 2);
      const offY = -((extH - canvas.height) / 2);

      // Deep Jungle Sky Gradient - covers extended area
      const skyGradient = ctx.createLinearGradient(0, offY, 0, offY + extH);
      skyGradient.addColorStop(0, "#022c22"); // Ultra deep teal
      skyGradient.addColorStop(0.4, "#064e3b");
      skyGradient.addColorStop(1, "#065f46");
      ctx.fillStyle = skyGradient;
      ctx.fillRect(offX, offY, extW, extH);

      // Atmospheric Fog / Horizon Depth
      const fogGradient = ctx.createLinearGradient(0, canvas.height * 0.4, 0, offY + extH);
      fogGradient.addColorStop(0, "rgba(5, 150, 105, 0)");
      fogGradient.addColorStop(1, "rgba(20, 184, 166, 0.2)");
      ctx.fillStyle = fogGradient;
      ctx.fillRect(offX, canvas.height * 0.4, extW, extH * 0.6);

      // 1. Distant Parallax Layer: Far Silhouettes
      ctx.fillStyle = "#011c15";
      for (let i = 0; i < 8; i++) {
        const x = ((i * 300 - game.cameraX * 0.05) % (extW + 600)) - 300 + offX;
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
        const startX = (i * 250 - (game.cameraX * 0.1) % 400) + 100;
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX + 150, 0);
        ctx.lineTo(startX - 200, 600);
        ctx.lineTo(startX - 350, 600);
        ctx.fill();
      }
      ctx.restore();

      // 3. Middle Parallax Layer: Thicker Trees
      ctx.fillStyle = "#022c22";
      for (let i = 0; i < 10; i++) {
        const x = ((i * 220 - game.cameraX * 0.2) % (extW + 400)) - 200 + offX;
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
      for (let i = 0; i < 12; i++) {
        const x = ((i * 150 - game.cameraX * 0.4) % (extW + 300)) - 150 + offX;
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
      const drawBlock = (segments: TerrainSegment[], layer: "soil" | "stone" | "moss") => {
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
      const blocks: TerrainSegment[][] = [];
      let currentBlock: TerrainSegment[] = [];

      game.terrain.forEach((segment: TerrainSegment) => {
        if (segment.endX < visibleStart || segment.startX > visibleEnd) return;

        // Check for interactions with gaps
        const overlappingGaps = game.obstacles.filter((o: Obstacle) => o.type === "gap" &&
          !(segment.endX <= o.x || segment.startX >= o.x + o.width)
        ).sort((a, b) => a.x - b.x);

        if (overlappingGaps.length === 0) {
          currentBlock.push({
            startX: segment.startX,
            endX: segment.endX,
            startY: getTerrainHeight(segment.startX, true),
            endY: getTerrainHeight(segment.endX, true),
          });
        } else {
          // Complex case: Segment hits one or more gaps.
          // We need to carve it up.
          let cursor = segment.startX;

          overlappingGaps.forEach(gap => {
            // 1. Draw solid ground BEFORE the gap
            if (cursor < gap.x) {
              // Create a temp segment for the solid part
              const end = Math.min(segment.endX, gap.x);
              currentBlock.push({
                startX: cursor,
                endX: end,
                startY: getTerrainHeight(cursor, true),
                endY: getTerrainHeight(end, true)
              });
            }

            // 2. We hit a gap. End the current block to break the visual mesh.
            if (currentBlock.length > 0) blocks.push(currentBlock);
            currentBlock = [];

            // 3. Move cursor to end of gap
            cursor = Math.max(cursor, gap.x + gap.width);
          });

          // 4. Trail after the last gap?
          if (cursor < segment.endX) {
            currentBlock.push({
              startX: cursor,
              endX: segment.endX,
              startY: getTerrainHeight(cursor, true),
              endY: getTerrainHeight(segment.endX, true)
            });
          }
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
      const charConfig = CHARACTER_STYLES[selectedCharacter];

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
        const slideY = p.y + p.height - SLIDE_HEIGHT;
        ctx.fillStyle = charConfig.stripeColor1;
        ctx.fillRect(screenX, slideY, p.width + 10, SLIDE_HEIGHT - 5);

        ctx.fillStyle = charConfig.skinColor;
        ctx.beginPath();
        ctx.arc(screenX + p.width + 5, slideY + SLIDE_HEIGHT / 2, 10, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = charConfig.maskColor;
        ctx.fillRect(screenX + p.width - 5, slideY + SLIDE_HEIGHT / 2 - 8, 20, 8);
      } else {
        const stripeWidth = 8;
        const bodyTop = p.y + 20 + bounce;
        const bodyHeight = p.height - 35;

        for (let i = 0; i < Math.ceil((p.width - 10) / stripeWidth); i++) {
          ctx.fillStyle = i % 2 === 0 ? charConfig.stripeColor1 : charConfig.stripeColor2;
          const stripeX = screenX + 5 + i * stripeWidth;
          const width = Math.min(stripeWidth, screenX + p.width - 5 - stripeX);
          ctx.fillRect(stripeX, bodyTop, width, bodyHeight);
        }

        ctx.fillStyle = charConfig.skinColor;
        ctx.beginPath();
        ctx.arc(screenX + p.width / 2, p.y + 12 + bounce, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = charConfig.maskColor;
        ctx.fillRect(screenX + p.width / 2 - 15, p.y + 8 + bounce, 30, 10);

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(screenX + p.width / 2 - 5, p.y + 12 + bounce, 3, 0, Math.PI * 2);
        ctx.arc(screenX + p.width / 2 + 5, p.y + 12 + bounce, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = charConfig.stripeColor1;
        ctx.fillRect(screenX + 8, p.y + p.height - 15, 10, 15);
        ctx.fillRect(screenX + p.width - 18, p.y + p.height - 15, 10, 15);

        if (p.state === "running") {
          const legOffset = Math.sin(game.frameCount * 0.4) * 5;
          ctx.fillRect(screenX + 8 + legOffset, p.y + p.height - 15, 10, 15);
          ctx.fillRect(screenX + p.width - 18 - legOffset, p.y + p.height - 15, 10, 15);
        }
      }

      ctx.fillStyle = charConfig.bagColor;
      ctx.beginPath();
      ctx.ellipse(screenX + p.width + 5, p.y + 35 + bounce, 12, 8, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(charConfig.bagSymbol, screenX + p.width + 5, p.y + 38 + bounce);

      if (p.state === "jumping" || p.state === "falling") {
        ctx.fillStyle = charConfig.skinColor;
        ctx.fillRect(screenX - 5, p.y + 25, 10, 5);
        ctx.fillRect(screenX + p.width - 5, p.y + 25, 10, 5);
      } else if (p.state === "swinging") {
        ctx.fillStyle = charConfig.skinColor;
        ctx.fillRect(screenX + p.width / 2 - 3, p.y - 10, 6, 15);
      }


      ctx.restore();
    };

    const drawPolice = () => {
      const police = game.police;
      const screenX = police.x - game.cameraX;

      if (screenX > -200) {
        ctx.save();
        const policeCenterX = police.x + 50;
        const policeOverGap = game.obstacles.some(o => o.type === "gap" && policeCenterX > o.x && policeCenterX < o.x + o.width);
        const pGroundY = policeOverGap ? BASE_GROUND_Y : getTerrainHeight(policeCenterX, true);
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

        if (policeOverGap) {
          const rotorX = screenX + 50;
          const rotorY = BASE_GROUND_Y - 85;
          ctx.save();
          ctx.strokeStyle = "#cbd5e1";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(rotorX, rotorY + 10);
          ctx.lineTo(rotorX, BASE_GROUND_Y - 65);
          ctx.stroke();
          ctx.translate(rotorX, rotorY);
          ctx.rotate(game.frameCount * 0.25);
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(-30, 0);
          ctx.lineTo(30, 0);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, -30);
          ctx.lineTo(0, 30);
          ctx.stroke();
          ctx.restore();
        }

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
          // Draw the ABYSS first (fill the hole with darkness)
          ctx.fillStyle = "#000000";
          ctx.fillRect(screenX, BASE_GROUND_Y, obs.width, canvas.height - BASE_GROUND_Y);

          ctx.save();
          // Side Walls (Depth) - subtle gradient to suggest dirt walls
          const sideWallGradient = ctx.createLinearGradient(screenX, BASE_GROUND_Y, screenX, canvas.height);
          sideWallGradient.addColorStop(0, "#2d1b0d");
          sideWallGradient.addColorStop(1, "#000000");

          ctx.fillStyle = sideWallGradient;
          // Left Wall
          ctx.fillRect(screenX, BASE_GROUND_Y, 20, canvas.height - BASE_GROUND_Y);
          // Right Wall
          ctx.fillRect(screenX + obs.width - 20, BASE_GROUND_Y, 20, canvas.height - BASE_GROUND_Y);

          // Sharp Moss edges
          ctx.strokeStyle = "#064e3b";
          ctx.lineWidth = 14;
          ctx.beginPath();
          ctx.moveTo(screenX, BASE_GROUND_Y);
          ctx.lineTo(screenX, BASE_GROUND_Y + 10);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(screenX + obs.width, BASE_GROUND_Y);
          ctx.lineTo(screenX + obs.width, BASE_GROUND_Y + 10);
          ctx.stroke();

          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(screenX, BASE_GROUND_Y); ctx.lineTo(screenX, BASE_GROUND_Y + 10); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(screenX + obs.width, BASE_GROUND_Y); ctx.lineTo(screenX + obs.width, BASE_GROUND_Y + 10); ctx.stroke();

          ctx.restore();
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

        case "low_beam":
          // "Slide Wall" - Big wall with a gap at the bottom
          // Draw from top of screen down to the slide height
          const gapHeight = SLIDE_HEIGHT + 20; // Enough space to slide under
          const wallBottom = groundY - gapHeight;

          // Wall Body
          ctx.fillStyle = "#334155"; // Slate-700
          ctx.fillRect(screenX, 0, obs.width, wallBottom);

          // Tech details / reinforcement
          ctx.fillStyle = "#1e293b"; // Slate-800
          ctx.fillRect(screenX + 5, 0, obs.width - 10, wallBottom - 5);

          // Hazard Stripes at the bottom edge
          const stripeSize = 10;
          ctx.fillStyle = "#f59e0b"; // Warning Orange
          ctx.fillRect(screenX, wallBottom - 20, obs.width, 20);

          ctx.fillStyle = "#000000";
          for (let i = 0; i < obs.width / stripeSize; i++) {
            if (i % 2 === 0) {
              ctx.fillRect(screenX + i * stripeSize, wallBottom - 20, stripeSize, 20);
            }
          }
          break;

        case "warning":
          // Warning Sign
          ctx.fillStyle = "#fbbf24"; // Yellow board
          ctx.beginPath();
          ctx.moveTo(screenX + 20, groundY - 80); // Top
          ctx.lineTo(screenX + 40, groundY - 20); // Right
          ctx.lineTo(screenX, groundY - 20); // Left
          ctx.fill();

          // Exclamation
          ctx.fillStyle = "#000000";
          ctx.font = "bold 40px sans-serif";
          ctx.fillText("!", screenX + 12, groundY - 30);

          // Post
          ctx.fillStyle = "#78350f";
          ctx.fillRect(screenX + 18, groundY - 20, 4, 20);
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

    const getVinePoint = (vine: Vine, t: number) => {
      const startX = vine.x;
      const startY = vine.anchorY;
      const endX = vine.x + Math.sin(vine.angle) * vine.length;
      const endY = vine.anchorY + Math.cos(vine.angle) * vine.length;

      const cp1x = vine.x + Math.sin(vine.angle * 0.5) * vine.length * 0.3;
      const cp1y = vine.anchorY + vine.length * 0.3;
      const cp2x = vine.x + Math.sin(vine.angle * 0.8) * vine.length * 0.7;
      const cp2y = vine.anchorY + vine.length * 0.7;

      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;

      const x = uuu * startX + 3 * uu * t * cp1x + 3 * u * tt * cp2x + ttt * endX;
      const y = uuu * startY + 3 * uu * t * cp1y + 3 * u * tt * cp2y + ttt * endY;
      return { x, y };
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

    const drawHelicopter = () => {
      const heli = game.plane; // Using 'plane' ref for Helicopter
      if (heli.state === "hidden") return;

      const screenX = heli.x - game.cameraX;

      ctx.save();
      ctx.translate(screenX, heli.y);

      // Body
      ctx.fillStyle = "#4a5568"; // Dark grey
      ctx.beginPath();
      ctx.ellipse(0, 0, 80, 30, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cockpit
      ctx.fillStyle = "#a0aec0"; // Lighter grey
      ctx.beginPath();
      ctx.ellipse(30, -10, 35, 20, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // Tail boom
      ctx.fillStyle = "#4a5568";
      ctx.fillRect(-80, -5, 60, 10);

      // Tail rotor
      ctx.fillStyle = "#2d3748";
      ctx.fillRect(-140, -10, 20, 20);
      ctx.save();
      ctx.translate(-130, 0);
      ctx.rotate(heli.rotorAngle * 2); // Faster spin for tail
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(-20, -2, 40, 4);
      ctx.restore();

      // Main rotor
      ctx.save();
      ctx.translate(0, -30);
      ctx.rotate(heli.rotorAngle);
      ctx.fillStyle = "#2d3748";
      ctx.fillRect(-100, -5, 200, 10);
      ctx.restore();

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

    // Check collisions
    const checkCollision = (p: Player, obs: Obstacle) => {
      if (p.invincible > 0) return false;
      // Ignore warning signs
      if (obs.type === "warning") return false;

      const pLeft = p.x;
      const pRight = p.x + p.width;
      const pTop = p.y;
      const pBottom = p.y + (p.state === "sliding" ? SLIDE_HEIGHT : p.height);
      const groundY = getTerrainHeight(obs.x + obs.width / 2);

      // Slide Wall Collision (formerly Low Beam)
      if (obs.type === "low_beam") {
        const wallGapHeight = SLIDE_HEIGHT + 20;
        const wallBottom = getTerrainHeight(obs.x) - wallGapHeight;
        // The wall exists from Y=0 to wallBottom.
        // If player Top < wallBottom, they hit the wall.
        if (p.x + p.width > obs.x && p.x < obs.x + obs.width) {
          if (pTop < 0) return false;
          if (pTop < wallBottom) {
            return true; // Bonk!
          }
        }
        return false;
      }

      switch (obs.type) {
        case "spike":
          const spikeLeft = obs.x + 5;
          const spikeRight = obs.x + obs.width - 5;
          const spikeTop = groundY - obs.height;
          const spikeBottom = groundY;
          return pRight > spikeLeft && pLeft < spikeRight && pBottom > spikeTop && pTop < spikeBottom;

        case "gap":
          const playerCenterXGap = p.x + p.width / 2;
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
      const baseZoom = 1;
      const zoomTarget = p.y < -50 ? Math.max(0.75, baseZoom + p.y / 600) : baseZoom;
      game.cameraZoom += (zoomTarget - game.cameraZoom) * 0.05;

      // Update Slope Physics
      // Use visual center queries to ignore pits (preventing massive slope spikes)
      const currentH = getTerrainHeight(p.x + 5, true);
      const nextH = getTerrainHeight(p.x + p.width + 5, true);
      const slope = (nextH - currentH) / p.width; // Positive = Downhill (increasing Y), Negative = Uphill (decreasing Y)

      if (slope < -0.1) { // Uphill (Y getting smaller)
        p.vx = Math.max(4, p.vx - 0.05); // Slow down on hills
      } else if (slope > 0.1) { // Downhill (Y getting bigger)
        const boost = p.state === "sliding" ? 1.5 : 0.05; // Insane boost for sliding
        p.vx = Math.min(50, p.vx + boost); // Speed cap 50
        if (p.state === "sliding") {
          const particleCount = p.vx > 30 ? 8 : 2;
          createParticles(p.x, p.y + p.height, "#ffffff", particleCount); // Speed air
          if (game.frameCount % 2 === 0) {
            createParticles(p.x, p.y + p.height, "#4a3728", 1); // Ground smoke/friction
          }
        }
      } else {
        // Momentum Preservation: Very low friction on flat ground
        if (p.vx > PLAYER_BASE_SPEED) p.vx *= 0.999;
        if (p.vx < PLAYER_BASE_SPEED) p.vx = Math.min(PLAYER_BASE_SPEED, p.vx + 0.1);
      }

      game.distanceTraveled += p.vx * 0.5; // Increased from 0.1 for faster metrics
      if (game.distanceTraveled >= game.nextGlideChargeDistance) {
        const charges = Math.floor((game.distanceTraveled - game.nextGlideChargeDistance) / GLIDE_CHARGE_DISTANCE) + 1;
        game.glideSeconds += charges * GLIDE_CHARGE_SECONDS;
        game.nextGlideChargeDistance += charges * GLIDE_CHARGE_DISTANCE;
      }
      const lastChargeBase = game.nextGlideChargeDistance - GLIDE_CHARGE_DISTANCE;
      game.glideChargeProgress = Math.min(1, Math.max(0, (game.distanceTraveled - lastChargeBase) / GLIDE_CHARGE_DISTANCE));
      game.scoreValue = Math.floor(game.distanceTraveled * 10) + game.coinsCollected * 100;

      if (p.invincible > 0) p.invincible--;

      // Scaling Difficulty: Police speed increases with distance
      const difficultyMultiplier = 1 + (game.distanceTraveled / 5000);
      game.police.speed = POLICE_SPEED * difficultyMultiplier;
      game.police.x += game.police.speed;

      // Checkpoint Trigger
      if (game.distanceTraveled >= CHECKPOINT_DISTANCE && !game.checkPointReached) {
        game.checkPointReached = true;
        setCheckpointActive(true);
        createParticles(p.x, p.y, "#4ade80", 30); // Green confetti
        // Could add a sound here
      }

      // Victory Condition: 40km Escape
      if (game.distanceTraveled >= VICTORY_DISTANCE && game.plane.state === "hidden") {
        game.plane.state = "entering";
        // Stop spawning obstacles
        game.nextTerrainX = Infinity;
      }

      // Helicopter Logic
      const heli = game.plane;
      if (heli.state !== "hidden") {
        heli.rotorAngle += 0.5; // Spin rotor

        if (heli.state === "entering") {
          heli.x += heli.vx;
          // Slow down and stop above player's future position
          if (heli.x < game.cameraX + CANVAS_WIDTH * 0.7) {
            heli.vx *= 0.95;
            if (Math.abs(heli.vx) < 0.1) {
              heli.state = "waiting";
            }
          }
        } else if (heli.state === "waiting") {
          // Hover wiggle
          heli.y = 100 + Math.sin(game.frameCount * 0.1) * 10;

          // Check if player jumps into helicopter zone
          const dx = (p.x + p.width / 2) - heli.x;
          const dy = p.y - heli.y;
          if (Math.sqrt(dx * dx + dy * dy) < 100 && p.y < 250) {
            // BOARD THE CHOPPA
            setGameState("victory");
            heli.state = "departing";
            p.state = "swinging"; // Hide player or attach
            // We'll actually hide player in draw or attach them visually
          }
        } else if (heli.state === "departing") {
          // Fly away!
          heli.x += 8;
          heli.y -= 2;
        }
      }

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
        const vineLength = p.vineLength || vine.length;

        const gravity = 0.002;
        vine.angularVelocity += -gravity * Math.sin(vine.angle);
        vine.angularVelocity *= 0.98; // Increased damping to reduce extreme swinging
        vine.angle += vine.angularVelocity;

        p.x = vine.x + Math.sin(vine.angle) * vineLength - p.width / 2;
        p.y = vine.anchorY + Math.cos(vine.angle) * vineLength - p.height / 2;

        game.vineSwingTime = (game.vineSwingTime || 0) + 1;

        if (!game.keys.up && game.vineSwingTime > 15) {
          const releaseSpeed = vine.angularVelocity * vineLength;

          const forwardBoost = Math.max(0, Math.cos(vine.angle)) * Math.abs(releaseSpeed) * 1.5;
          p.vx = PLAYER_BASE_SPEED + forwardBoost;
          p.vy = -Math.abs(Math.sin(vine.angle) * releaseSpeed) * 1.2 - 6;

          p.vx = Math.max(PLAYER_BASE_SPEED + 1, Math.min(p.vx, PLAYER_BASE_SPEED * 3));

          p.state = "jumping";
          p.onVine = null;
          p.vineLength = 0;
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

        const playerCenterX = p.x + p.width / 2;
        const playerLeftX = p.x + 5;
        const playerRightX = p.x + p.width - 5;

        const overGap = game.obstacles.some(o => {
          if (o.type !== "gap") return false;
          const inGapLeft = playerLeftX > o.x && playerLeftX < o.x + o.width;
          const inGapRight = playerRightX > o.x && playerRightX < o.x + o.width;
          const inGapCenter = playerCenterX > o.x && playerCenterX < o.x + o.width;
          return inGapLeft || inGapRight || inGapCenter;
        });

        const groundY = getTerrainHeight(playerCenterX);

        if (game.keys.down && p.y >= groundY - PLAYER_HEIGHT - 5 && p.state !== "jumping" && !overGap) {
          p.state = "sliding";
          p.height = SLIDE_HEIGHT;
        } else if (!game.keys.down && p.state === "sliding") {
          p.state = "running";
          p.height = PLAYER_HEIGHT;
          p.y = groundY - PLAYER_HEIGHT;
        }

        if (game.keys.up && p.y >= groundY - PLAYER_HEIGHT - 5 && p.state !== "swinging" && !overGap) {
          p.vy = JUMP_FORCE;
          p.state = "jumping";
          p.height = PLAYER_HEIGHT; // Reset height if jumping from slide
          createParticles(p.x + p.width / 2, p.y + p.height, "#8d6e63", 3);
          soundRef.current.playJump();
        }

        const isAirborne = p.y + p.height < groundY - 5;
        let gravityScale = 1;
        if (game.keys.up && isAirborne && game.glideSeconds > 0) {
          gravityScale = 0.2;
          game.glideSeconds = Math.max(0, game.glideSeconds - 1 / 60);
          if (p.vy > 2) p.vy = 2;
        }

        p.vy += GRAVITY * gravityScale;
        p.y += p.vy;
        p.x += p.vx;

        let onRamp = false;
        let isOverGap = overGap; // Local copy for below logic

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
            const inGapLeft = playerLeftX > obs.x && playerLeftX < obs.x + obs.width;
            const inGapRight = playerRightX > obs.x && playerRightX < obs.x + obs.width;
            const inGapCenter = playerCenterX > obs.x && playerCenterX < obs.x + obs.width;
            if (inGapLeft || inGapRight || inGapCenter) {
              isOverGap = true;
            }
          }
        });

        if (!onRamp && !isOverGap) {
          const currentGroundY = getTerrainHeight(p.x + p.width / 2);
          const targetY = currentGroundY - (p.state === "sliding" ? SLIDE_HEIGHT : PLAYER_HEIGHT);
          const playerBottom = p.y + p.height;

          if (playerBottom >= currentGroundY - 2) {
            if (p.state === "running" || p.state === "sliding") {
              p.y = targetY;
              p.vy = 0;
            } else if (p.state === "jumping" || p.state === "falling") {
              p.y = targetY;
              p.vy = 0;
              p.state = game.keys.down ? "sliding" : "running";
              createParticles(p.x + p.width / 2, p.y + p.height, "#8d6e63", 2);
              game.shake = 8;
            }
          } else if (playerBottom < currentGroundY - 15 && p.state !== "jumping") {
            p.state = "falling";
          }
        } else if (isOverGap && p.state !== "swinging") {
          // If we are over a gap and not swinging, we MUST fall.
          // Even if we are "jumping", once we are over the pit, the abyss is the only ground.
          p.state = "falling";
        }
      }

      game.vines.forEach((vine: Vine) => {
        if (p.state !== "swinging" && !game.vineGrabCooldown) {
          const playerX = p.x + p.width / 2;
          const playerY = p.y + p.height / 2;
          let closestDist = Infinity;
          let closestPoint = { x: 0, y: 0 };

          for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            const point = getVinePoint(vine, t);
            const dx = playerX - point.x;
            const dy = playerY - point.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < closestDist) {
              closestDist = dist;
              closestPoint = point;
            }
          }

          // Manual Grab: Require UP key + reasonable radius
          if (closestDist < VINE_GRAB_RADIUS && game.keys.up && (p.state === "jumping" || p.state === "falling")) {
            p.state = "swinging";
            p.onVine = vine;
            p.vineLength = Math.max(40, Math.hypot(closestPoint.x - vine.x, closestPoint.y - vine.anchorY));
            game.vineSwingTime = 0;
            game.vineGrabCooldown = 15;

            const entrySpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            vine.angularVelocity = entrySpeed * 0.01 * (p.vx > 0 ? 1 : -1);

            p.vy = 0;
            p.height = PLAYER_HEIGHT;
            p.x = closestPoint.x - p.width / 2;
            p.y = closestPoint.y - p.height / 2;
            soundRef.current.playVineGrab();
          }
        }
      });

      if (game.vineGrabCooldown > 0) {
        game.vineGrabCooldown--;
      }

      game.obstacles = game.obstacles.filter(obs => {
        if (checkCollision(p, obs)) {
          // Special Handling for Wall Hit (Non-Lethal)
          if (obs.type === "low_beam") {
            // Slow down player significantly
            p.vx = 2;
            game.shake = 10;
            createParticles(p.x + p.width / 2, p.y + p.height / 2, "#f59e0b", 5); // Sparks
            // Bounce back slightly to prevent sticking
            p.x -= 20;
            return true; // Keep obstacle
          }

          // Lethal hit
          createParticles(p.x + p.width / 2, p.y + p.height / 2, "#e53935", 10);
          gameOver();
          return false;
        }

        // Check against end of obstacle to ensure large pits don't vanish
        return obs.x + (obs.width || 60) > game.cameraX - 200;
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
            soundRef.current.playCoin();
            createParticles(coin.x, coin.y, "#fbbf24", 5);
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

      // Memory Cleanup
      if (game.frameCount % 60 === 0) {
        const cullX = game.cameraX - 1000;
        game.terrain = game.terrain.filter(t => t.endX > cullX);
        game.obstacles = game.obstacles.filter(o => o.x + o.width > cullX);
        game.coinsList = game.coinsList.filter(c => c.x > cullX || !c.collected);
        game.particles = game.particles.filter(p => p.life > 0);
      }

      // Camera Follow
      const targetCamX = p.x - CANVAS_WIDTH * 0.3;
      game.cameraX += (targetCamX - game.cameraX) * 0.1;

      const spawnX = game.cameraX + CANVAS_WIDTH + 800;

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
      const glideDisplay = Math.round(game.glideSeconds * 10) / 10;
      if (glideDisplay !== game.lastDisplayedGlideSeconds) {
        setGlideSeconds(glideDisplay);
        game.lastDisplayedGlideSeconds = glideDisplay;
      }
      const glideProgressDisplay = Math.round(game.glideChargeProgress * 100) / 100;
      if (glideProgressDisplay !== game.lastDisplayedGlideProgress) {
        setGlideChargeProgress(glideProgressDisplay);
        game.lastDisplayedGlideProgress = glideProgressDisplay;
      }
    };

    const drawRadar = () => {
      ctx.save();
      const centerX = 110; // Relocated to left side
      const centerY = CANVAS_HEIGHT - 110;
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
      // Camera Transform with Vertical Follow for Zoom
      // If we are zoomed out, we want to track the player's height to keep them centered
      // Zoom centers on screen center (CANVAS_WIDTH/2, CANVAS_HEIGHT/2)
      // We need to shift the context downwards if the player is high up

      let verticalOffset = 0;
      if (game.cameraZoom < 1) {
        // The "center" of the view in world-space moves up as we zoom out.
        // We need to counteract this if the player is flying high.
        // Simple strategy: Keep player roughly in the middle vertical third
        const playerScreenY = game.player.y;
        const targetScreenY = CANVAS_HEIGHT * 0.4; // Aim for slightly above center
        verticalOffset = (targetScreenY - playerScreenY) * (1 - game.cameraZoom);
      }

      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + verticalOffset);
      ctx.scale(game.cameraZoom, game.cameraZoom);
      ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2 - verticalOffset);

      drawBackground();
      drawFireflies();
      drawRain();

      game.vines.forEach(drawVine);
      drawTerrain();
      // Safe drawing with explicit types
      game.obstacles.forEach((o: Obstacle) => drawObstacle(o));
      game.coinsList.forEach((c: Coin) => drawCoin(c));

      // Helicopter Visuals (only draw when not hidden)
      if (game.plane.state !== "hidden") {
        const helX = game.plane.x;
        const helY = game.plane.y;

        ctx.save();

        // Body (Dark Green Military)
        ctx.fillStyle = "#3f6212";
        ctx.beginPath();
        ctx.ellipse(helX, helY, 70, 30, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tail
        ctx.beginPath();
        ctx.moveTo(helX - 50, helY);
        ctx.lineTo(helX - 120, helY - 10);
        ctx.lineTo(helX - 120, helY + 10);
        ctx.lineTo(helX - 50, helY + 10);
        ctx.fill();

        // Tail Rotor
        ctx.save();
        ctx.translate(helX - 120, helY);
        ctx.rotate(game.plane.rotorAngle * 2);
        ctx.fillStyle = "#cbd5e1";
        ctx.fillRect(-5, -20, 10, 40);
        ctx.fillRect(-20, -5, 40, 10);
        ctx.restore();

        // Cockpit window
        ctx.fillStyle = "#93c5fd";
        ctx.beginPath();
        ctx.arc(helX + 30, helY - 10, 20, 0, Math.PI * 2);
        ctx.fill();

        // Skids
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(helX - 40, helY + 30);
        ctx.lineTo(helX + 40, helY + 30);
        ctx.moveTo(helX - 30, helY + 20);
        ctx.lineTo(helX - 40, helY + 30);
        ctx.moveTo(helX + 30, helY + 20);
        ctx.lineTo(helX + 40, helY + 30);
        ctx.stroke();

        // Main Rotor (Blur effect)
        ctx.fillStyle = `rgba(203, 213, 225, 0.5)`; // Semi-transparent blade blur
        ctx.fillRect(helX - 140, helY - 35, 280, 4);
        // Active blade
        ctx.fillStyle = "#cbd5e1";
        ctx.save();
        ctx.translate(helX, helY - 35);
        // Scale X to simulate rotation
        ctx.scale(Math.sin(game.plane.rotorAngle), 1);
        ctx.fillRect(-140, -5, 280, 10);
        ctx.restore();

        // Rotor mast
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(helX - 5, helY - 35, 10, 15);

        ctx.restore();
      }

      drawPolice();
      // Don't draw player if they are in the plane (departing)? 
      // Actually, drawing them helps visibility.
      if (game.plane.state !== "departing") {
        drawPlayer();
      }
      drawParticles();

      ctx.restore();

      drawVignette();

      // Radar must be on TOP of everything (last layer)
      drawRadar();
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
  }, [gameState, gameOver, spawnObstacle, spawnVine, spawnCoin, createParticles, getTerrainHeight, generateTerrain, selectedCharacter]);

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    // e.preventDefault(); // Don't prevent default on everything, might block UI interaction
    if (gameState === "playing") {
      gameRef.current.keys.up = true;
      // Play jump sound on touch if not already playing? 
      // Better: rely on the update loop or strict trigger.
      // Actually, standard is:
      if (gameRef.current.player.state !== "falling") {
        soundRef.current.playJump();
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
    // e.preventDefault();
    if (gameState === "playing") {
      gameRef.current.keys.up = false;
    }
  };

  const handleMouseDown = handleTouchStart;
  const handleMouseUp = handleTouchEnd;

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
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block w-full h-full touch-none"
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}

          style={{ width: "100%", height: "100%" }}
        />

        {gameState === "playing" && (
          <>
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
                <div className="mt-2">
                  <div className="text-[10px] font-semibold text-white/60 uppercase tracking-widest">Glide</div>
                  <div className="mt-1 h-2 w-32 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all duration-200"
                      style={{
                        width: `${Math.min(100, ((glideSeconds + glideChargeProgress * GLIDE_CHARGE_SECONDS) / GLIDE_MAX_DISPLAY_SECONDS) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1 text-[10px] text-white/60" data-testid="text-glide-seconds">
                    {glideSeconds.toFixed(1)}s
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
            <div className="mb-4 md:mb-8 text-center">
              <h1
                className="text-5xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-orange-300 to-yellow-400 animate-pulse tracking-tight drop-shadow-sm"
                style={{ fontFamily: "'Poppins', sans-serif" }}
                data-testid="text-game-title"
              >
                HEIST RUNNER
              </h1>
            </div>
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
                placeholder="Enter Name"
                className={`bg-gray-800 text-white px-4 py-2 rounded text-center border-2 ${!playerName.trim() ? "border-red-500" : "border-gray-600"} focus:border-green-500 outline-none w-64`}
                maxLength={12}
                data-testid="input-player-name"
              />
            </div>
            <p className="text-gray-400 text-sm mt-2">
              {!playerName.trim() ? "Name required" : "Use Arrow Keys or Tap to Jump"}
            </p>

            <div className="mt-4 mb-4">
              <p className="text-white/70 text-sm mb-2 text-center">Select Character:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {(Object.keys(CHARACTER_STYLES) as CharacterStyle[]).map((style) => {
                  const config = CHARACTER_STYLES[style];
                  const isSelected = selectedCharacter === style;
                  return (
                    <button
                      key={style}
                      onClick={() => {
                        setSelectedCharacter(style);
                        localStorage.setItem("selectedCharacter", style);
                      }}
                      className={`flex flex-col items-center p-2 rounded-lg border-2 transition-all ${isSelected
                        ? "border-yellow-400 bg-yellow-400/20"
                        : "border-white/20 bg-black/30 hover:border-white/40"
                        }`}
                      data-testid={`button-character-${style}`}
                    >
                      <div className="w-10 h-14 relative">
                        <div
                          className="absolute inset-x-1 top-0 h-3 rounded-full"
                          style={{ backgroundColor: config.skinColor }}
                        />
                        <div
                          className="absolute inset-x-0 top-1 h-2 rounded-sm"
                          style={{ backgroundColor: config.maskColor }}
                        />
                        <div className="absolute inset-x-0 top-4 bottom-2 flex">
                          <div className="w-1/2 h-full" style={{ backgroundColor: config.stripeColor1 }} />
                          <div className="w-1/2 h-full" style={{ backgroundColor: config.stripeColor2 }} />
                        </div>
                        <div
                          className="absolute bottom-0 inset-x-1 h-2"
                          style={{ backgroundColor: config.stripeColor1 }}
                        />
                      </div>
                      <span className="text-xs text-white/80 mt-1 whitespace-nowrap">{config.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {highScore > 0 && (
              <p className="text-lg text-yellow-400 mb-4" data-testid="text-high-score">
                Your Best: {highScore.toLocaleString()}
              </p>
            )}

            <Button
              size="lg"
              onClick={startGame}
              disabled={!playerName.trim()}
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
    </div >
  );
}
