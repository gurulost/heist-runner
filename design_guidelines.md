# Design Guidelines: Side-Scrolling Endless Runner Game

## Design Approach
**Reference-Based**: Drawing inspiration from modern endless runners (Subway Surfers, Alto's Adventure) and classic platformers, with emphasis on fluid animation, clear visual feedback, and intuitive controls.

## Core Design Principles
- **Immediacy**: Game must be playable within 2 seconds of page load
- **Clarity**: All interactive elements and obstacles instantly recognizable
- **Responsiveness**: Silky-smooth animations at 60fps
- **Progressive Challenge**: Visual design supports increasing difficulty

## Layout System

### Game Canvas
- Full viewport gameplay area (w-full h-screen)
- Fixed aspect ratio maintained: 16:9 preferred, scales responsively
- Game world extends beyond viewport (parallax scrolling background)

### HUD Layout (Heads-Up Display)
**Top Bar** (absolute positioning, top-0, w-full, p-4):
- Left: Score counter (text-2xl font-bold)
- Center: Distance traveled (text-xl)
- Right: Lives/health indicator (flex gap-2)

**Bottom Controls** (absolute, bottom-8, w-full, text-center):
- Touch/click zones for mobile (invisible, full-width thirds)
- Keyboard hints (subtle, text-sm, opacity-70): "↑ Jump | ↓ Slide | ← → Move"

### Spacing System
Primary units: 1, 2, 4, 8, 16 for all game elements
- Character size: w-16 h-16 base unit
- Obstacle spacing: gap-8 to gap-16
- Platform heights: multiples of 4
- Vine swing points: fixed grid of 8-unit spacing

## Typography

### Fonts
- **Primary**: "Press Start 2P" or "Fredoka One" (Google Fonts) - playful, retro-gaming feel
- **Secondary**: "Poppins" - UI elements, menus, instructions

### Hierarchy
- Game title: text-6xl font-black (start screen)
- Score/stats: text-3xl font-bold (in-game)
- Instructions: text-lg font-medium
- Button text: text-xl font-semibold

## Component Library

### Game Screens

**Start Screen** (full viewport, centered flex):
- Game title (massive, bouncing animation on load)
- High score display (text-2xl, mt-4)
- Play button (px-12 py-4, rounded-full, text-2xl)
- Quick instructions (max-w-md, text-center, mt-8)

**Game Over Screen** (overlay, centered):
- Semi-transparent backdrop (bg-opacity-90)
- Final score (text-5xl, font-black)
- Stats: Distance, coins collected, obstacles avoided (grid grid-cols-3, gap-4, mt-8)
- Restart button (px-10 py-3, rounded-full)
- Home button (secondary style, mt-4)

**Pause Menu** (overlay, centered):
- Resume button (primary)
- Restart option (secondary)
- Settings toggle (icon button)

### Game Elements

**Character Design**:
- Simple, geometric sprite (16x16 base unit, scales to w-20 h-20 on screen)
- Three states: running (default), jumping (stretched vertically), sliding (compressed)
- Idle animation: subtle bounce (animate-bounce with duration-1000)

**Environment Elements**:
- **Vines**: Vertical lines from top (h-40 to h-64), rope texture indicator, swing anchor point (w-3 h-3 rounded-full)
- **Ramps**: Triangular shapes, 45° or 30° angles, smooth slopes
- **Platforms**: Rectangular, varied widths (w-32 to w-96), height variations
- **Obstacles**: Distinct shapes - spikes (triangular), logs (rounded rectangles), gaps (empty space)

**Background Layers** (Parallax scrolling):
- Layer 1 (slowest): Distant mountains/skyline, opacity-30
- Layer 2 (medium): Mid-ground trees/ruins, opacity-60
- Layer 3 (fastest): Foreground elements, full opacity
- Ground layer: Tiled texture, repeating pattern

### UI Components

**Buttons**:
- Primary: Large (min-w-48), rounded-full, shadow-lg, text-xl
- Secondary: Outlined style, rounded-lg
- Icon buttons: Circular (w-12 h-12), top-right placement for pause/settings

**Score Display**:
- Continuous counter with smooth increment animation
- Milestone celebrations: +100, +500, +1000 (brief scale animation)
- Combo multiplier (when applicable): floating text above character

**Power-ups/Collectibles**:
- Coins: Spinning animation (animate-spin), w-8 h-8
- Shields: Pulsing glow effect
- Speed boosts: Streak/dash indicator

**Progress Indicators**:
- Distance bar: Linear progress at screen top (h-2, w-full)
- Checkpoints: Markers every 100m

## Animations & Interactions

**Character Animations**:
- Running: Looping sprite cycle (4-6 frames)
- Jumping: Smooth arc trajectory (cubic-bezier easing)
- Sliding: Quick transition (duration-200)
- Vine swinging: Pendulum motion (smooth sine wave)
- Death: Tumble animation + fade out

**Environment Animations**:
- Parallax scrolling: Continuous transform-translateX
- Vine swaying: Subtle rotation (-5° to 5°)
- Platform crumbling: Shake effect before falling
- Obstacle indicators: Pulse/glow before character reaches them

**Feedback Animations**:
- Coin collection: Fly to score counter + brief scale
- Collision: Screen shake (2px, duration-100)
- Power-up activation: Full-screen flash + character aura
- Milestone reached: Confetti burst effect

## Responsive Design

**Desktop** (lg: and up):
- Full keyboard controls active
- Larger game canvas (max-w-7xl centered)
- Side panels for leaderboard (optional)

**Tablet** (md:):
- Touch zones overlay
- Scaled UI elements (80% size)
- Simplified background layers

**Mobile** (base):
- Full-screen game canvas
- Large touch targets (min-h-20)
- Simplified HUD (essential info only)
- Gesture controls: Swipe up (jump), down (slide), left/right (move)

## Images
**Background**: Layered landscape illustrations for parallax effect - jungle/temple theme with ruins, vines, ancient structures. Each layer separate for scrolling.
**Character**: Pixel-art style adventurer sprite sheet (running, jumping, sliding animations)
**Obstacles**: Stylized icons - spikes, logs, gaps clearly distinguishable
**Power-ups**: Glowing coin sprites, shield icons, speed boost effects
**UI Elements**: Start screen backdrop showing jungle scene preview

No large hero image - game launches directly into playable state or animated start screen.