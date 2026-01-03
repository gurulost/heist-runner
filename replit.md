# Heist Runner - Police Chase Endless Runner Game

## Overview
A side-scrolling endless runner adventure game built with React and HTML5 Canvas. Players control a robber escaping from police, running through an urban environment while jumping over obstacles, sliding under barriers, swinging on ropes, and collecting coins.

## Current State
Fully functional MVP with:
- Canvas-based 60fps game loop with camera follow system
- Player stays at 1/3 screen width, world scrolls based on player speed
- Robber character with striped prison outfit, mask, and money bag
- Police car chase mechanic - game over when caught (BUSTED!)
- Procedural terrain with rolling hills and valleys
- Physics-based rope swinging (Stickman Hook style)
- Obstacles: spikes, rolling logs, gaps/pits, ramps
- Parallax scrolling city backgrounds
- Coin collection system
- Score tracking with local and server leaderboards
- Responsive design with mobile touch controls

## Project Architecture

### Frontend (client/)
- **pages/game.tsx**: Main game component with canvas rendering, game loop, and React UI overlays
- **App.tsx**: Router setup with game as home page
- Uses React Query for high score API integration

### Backend (server/)
- **routes.ts**: API endpoints for high scores (GET/POST /api/highscores)
- **storage.ts**: In-memory storage for high scores

### Shared (shared/)
- **schema.ts**: TypeScript types and Zod schemas for HighScore model

## Game Mechanics

### Camera System
- Camera follows player with player positioned at 1/3 screen width
- World scrolls based on player's actual speed, not constant rate
- Creates dynamic feel as player speeds up/slows down

### Police Chase
- Police car pursues from behind at constant speed (3.5 units)
- Warning HUD shows when police gets close (< 300px)
- Game over with "BUSTED!" if police catches player
- Creates tension - player must maintain speed

### Rope Swinging (Stickman Hook style)
- Grab ropes by holding UP while near rope end
- Angular momentum from entry velocity
- Physics simulation with gravity and damping
- Release by letting go of UP key (after 10+ frames)
- Forward boost on release based on swing angle and speed
- Grab cooldown prevents instant re-grab

### Terrain Generation
- Procedural rolling hills with heights varying 280-400
- Smooth transitions between segments
- Supports gaps/pits with proper collision detection

### Gap Collision
- Player must actually fall into pit to die
- Samples terrain height at both edges of gap
- Requires falling 150px below lowest edge
- Prevents edge-skim deaths

## Game Controls
- **Keyboard**: UP/SPACE to jump (hold to grab ropes), DOWN to slide, ESC to pause
- **Mobile**: Touch JUMP and SLIDE buttons during gameplay
- Release UP key to launch from rope

## API Endpoints
- `GET /api/highscores` - Get top 10 high scores
- `POST /api/highscores` - Submit new high score

## Recent Changes
- Transformed from Jungle Runner to Heist Runner theme
- Implemented camera-follow system
- Added police car chase mechanic
- Built procedural terrain with hills and valleys
- Overhauled rope swinging to Stickman Hook style physics
- Fixed gap collision to only trigger on actual falls
- Added robber character visual with striped outfit
