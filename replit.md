# Jungle Runner - Endless Adventure Game

## Overview
A side-scrolling endless runner adventure game built with React and HTML5 Canvas. Players control a character running through a jungle, jumping over obstacles, sliding under barriers, swinging on vines, and collecting coins.

## Current State
Fully functional MVP with:
- Canvas-based 60fps game loop
- Character states: running, jumping, sliding, vine swinging
- Obstacles: spikes, logs, gaps, ramps
- Parallax scrolling backgrounds
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

## Game Controls
- **Keyboard**: UP/SPACE to jump, DOWN to slide, ESC to pause
- **Mobile**: Touch JUMP and SLIDE buttons during gameplay

## API Endpoints
- `GET /api/highscores` - Get top 10 high scores
- `POST /api/highscores` - Submit new high score

## Recent Changes
- Built complete game with all mechanics
- Added high score API integration
- Implemented leaderboard display on start screen
- Added player name input with localStorage persistence
- Mobile touch controls for gameplay
