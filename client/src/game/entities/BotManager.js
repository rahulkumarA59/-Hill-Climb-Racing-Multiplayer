// ============================================================================
// BotManager.js — Lightweight AI Bot System for "Play with Bots" mode
// ============================================================================
// Each bot is a ghost (visual-only) racer with:
//   - Difficulty-based speed profile (Easy / Medium / Hard)
//   - Rubber banding to keep races competitive
//   - Random mistakes for human-like behavior
//   - Terrain-aware positioning via getHeightAt()
//   - GhostCar rendering (no physics bodies = zero FPS impact)
//   - Nitro Boost system with AI decision logic (same rules as player)
// ============================================================================

import GhostCar from './GhostCar';
import { NITRO_CONFIG } from '../PhysicsConfig.js';

// ============================================================================
// Bot Speed Calibration Notes:
// Player car maxSpeed = 7.5 px/frame, bike = 8.0 px/frame
// At 60fps, delta ≈ 16.67ms, so player covers ~7.5 px per frame.
// Bot distance = speed * delta. To match player:
//   botSpeed * 16.67 ≈ 5 to 7.5 → botSpeed ≈ 0.30 to 0.45 px/ms
// This ensures bots are competitive but NOT faster than the player.
// ============================================================================

const BOT_PROFILES = {
  easy: {
    baseSpeedMin: 0.34,      // ~5.7 px/frame — competitive but beatable
    baseSpeedMax: 0.39,      // ~6.5 px/frame
    mistakeChance: 0.0025,   // ~12% per second — occasional mistakes
    mistakeSlowdown: 0.6,    // mild slowdown during mistakes (was 0.3)
    mistakeDurationMin: 500, // short mistakes (was 1500)
    mistakeDurationMax: 1500, // max 1.5s mistake (was 4000)
    rubberBandBoost: 0.20,   // strong catch-up when behind
    rubberBandSlow: 0.10,    // gentle slowdown when ahead
    slopeSlowdown: 0.30,     // moderate uphill penalty (was 0.55)
    accelDelay: 1200,        // faster start (was 2000)
    minSpeedFactor: 0.60,    // never drop below 60% of base speed
  },
  medium: {
    baseSpeedMin: 0.38,      // ~6.3 px/frame — closely matches player
    baseSpeedMax: 0.43,      // ~7.2 px/frame
    mistakeChance: 0.0012,   // ~6% per second — rare mistakes
    mistakeSlowdown: 0.7,    // light slowdown (was 0.4)
    mistakeDurationMin: 400,
    mistakeDurationMax: 1200,
    rubberBandBoost: 0.18,
    rubberBandSlow: 0.08,
    slopeSlowdown: 0.25,     // handles slopes well (was 0.40)
    accelDelay: 900,
    minSpeedFactor: 0.65,
  },
  hard: {
    baseSpeedMin: 0.41,      // ~6.8 px/frame — strong competitor
    baseSpeedMax: 0.45,      // ~7.5 px/frame — equals player max
    mistakeChance: 0.0005,   // ~3% per second — very rare
    mistakeSlowdown: 0.8,    // barely slows down on mistakes
    mistakeDurationMin: 300,
    mistakeDurationMax: 800,
    rubberBandBoost: 0.15,   // moderate catch-up
    rubberBandSlow: 0.06,    // barely slows when ahead (keeps pressure)
    slopeSlowdown: 0.18,     // barely affected by slopes
    accelDelay: 600,
    minSpeedFactor: 0.70,    // never drops below 70% of base
  }
};

// ============================================================================
// Bot Nitro AI Strategy Profiles
// Controls WHEN the bot decides to use nitro — not HOW strong it is.
// All bots use the exact same NITRO_CONFIG values as the player.
// ============================================================================

const NITRO_STRATEGIES = [
  { // Aggressive — uses nitro early, proactively, for overtaking or extending leads
    name: 'aggressive',
    firstUseMin: 4000,           // ms — can nitro as early as 4s into race
    firstUseMax: 10000,          // randomized per bot instance
    overtakeThreshold: 150,      // px behind player → trigger nitro
    extendLeadThreshold: 100,    // px ahead → use nitro to push further away
    finalPushPercent: 0.75,      // use remaining nitro at 75% completion
    flatOpportunismChance: 0.002, // per decision check on flat terrain
    hotStreakChance: 0.0008,     // random surprise nitro (unpredictable)
    reactionDelay: 200,          // ms decision delay (fast reaction)
    slopeThreshold: 0.12,        // won't nitro above this slope
  },
  { // Balanced — uses nitro mid-race, situationally
    name: 'balanced',
    firstUseMin: 8000,
    firstUseMax: 18000,
    overtakeThreshold: 350,
    extendLeadThreshold: 250,
    finalPushPercent: 0.85,
    flatOpportunismChance: 0.001,
    hotStreakChance: 0.0004,
    reactionDelay: 500,
    slopeThreshold: 0.10,
  },
  { // Defensive — saves nitro for critical moments and end-game push
    name: 'defensive',
    firstUseMin: 18000,
    firstUseMax: 30000,
    overtakeThreshold: 600,
    extendLeadThreshold: 400,
    finalPushPercent: 0.90,
    flatOpportunismChance: 0.0005,
    hotStreakChance: 0.0002,
    reactionDelay: 800,
    slopeThreshold: 0.08,
  }
];

class BotRacer {
  constructor(scene, playerData, terrain, startX) {
    this.scene = scene;
    this.id = playerData.id;
    this.name = playerData.name;
    this.color = playerData.color;
    this.vehicle = playerData.vehicle;
    this.difficulty = playerData.difficulty || 'medium';
    this.profile = BOT_PROFILES[this.difficulty];
    this.terrain = terrain;
    this.startX = startX;

    // State
    this.distance = 0;
    this.x = startX;
    this.y = 0;
    this.rotation = 0;
    this.currentSpeed = 0;
    this.baseSpeed = this.profile.baseSpeedMin +
      Math.random() * (this.profile.baseSpeedMax - this.profile.baseSpeedMin);
    this.elapsed = 0;
    this.isFinished = false;
    this.finishTime = 0;
    this.totalCoins = Math.floor(Math.random() * 50);

    // Mistake state
    this.isMistaking = false;
    this.mistakeTimer = 0;
    this.mistakeDuration = 0;

    // Unique per-bot fluctuation offset
    this._fluctuationOffset = Math.random() * 2000;

    // ── Nitro System (exact same rules as player) ──
    this.nitroUsesRemaining = NITRO_CONFIG.maxUses;     // 2
    this.nitroIsActive = false;
    this.nitroIsCooldown = false;
    this.nitroBoostTimer = 0;
    this.nitroGapTimer = 0;
    this.nitroCooldownTimer = 0;
    this.nitroIntensity = 0;
    this.nitroDecisionTimer = 0;

    // Each bot gets a random strategy (spread across aggressive/balanced/defensive)
    this.nitroStrategy = NITRO_STRATEGIES[Math.floor(Math.random() * NITRO_STRATEGIES.length)];

    // Randomized first-use timing within the strategy's range (unique per bot per race)
    this._nitroFirstUseTime = this.nitroStrategy.firstUseMin +
      Math.random() * (this.nitroStrategy.firstUseMax - this.nitroStrategy.firstUseMin);

    // Cached terrain slope for nitro decisions
    this._currentSlope = 0;

    // Visual ghost
    this.ghost = new GhostCar(scene, {
      id: this.id,
      name: this.name,
      color: this.color,
      vehicle: this.vehicle
    });
  }

  // ── NITRO: Can activate? ───────────────────────────────────────────
  canActivateNitro() {
    if (this.nitroIsActive) return false;
    if (this.nitroIsCooldown) return false;
    if (this.nitroUsesRemaining <= 0) return false;
    if (this.nitroGapTimer > 0) return false;
    return true;
  }

  // ── NITRO: Activate ────────────────────────────────────────────────
  activateNitro() {
    if (!this.canActivateNitro()) return false;
    this.nitroUsesRemaining--;
    this.nitroIsActive = true;
    this.nitroBoostTimer = NITRO_CONFIG.boostDuration; // 2500ms
    this.nitroIntensity = 0;
    return true;
  }

  // ── NITRO: Update timers ───────────────────────────────────────────
  updateNitro(delta) {
    if (this.nitroIsActive) {
      this.nitroBoostTimer -= delta;

      // Smooth ramp-up (300ms) / ramp-down (500ms) — same as player
      const totalDuration = NITRO_CONFIG.boostDuration;
      const elapsed = totalDuration - this.nitroBoostTimer;
      if (elapsed < 300) {
        this.nitroIntensity = Math.min(1, elapsed / 300);
      } else if (this.nitroBoostTimer < 500) {
        this.nitroIntensity = Math.max(0, this.nitroBoostTimer / 500);
      } else {
        this.nitroIntensity = 1;
      }

      if (this.nitroBoostTimer <= 0) {
        this.nitroIsActive = false;
        this.nitroIntensity = 0;
        this.nitroBoostTimer = 0;
        this.nitroGapTimer = NITRO_CONFIG.gapBetweenUses; // 3000ms

        if (this.nitroUsesRemaining <= 0) {
          this.nitroIsCooldown = true;
          this.nitroCooldownTimer = NITRO_CONFIG.cooldownDuration; // 45000ms
          this.nitroGapTimer = 0;
        }
      }
    }

    if (this.nitroGapTimer > 0) {
      this.nitroGapTimer -= delta;
      if (this.nitroGapTimer <= 0) this.nitroGapTimer = 0;
    }

    if (this.nitroIsCooldown) {
      this.nitroCooldownTimer -= delta;
      if (this.nitroCooldownTimer <= 0) {
        this.nitroIsCooldown = false;
        this.nitroCooldownTimer = 0;
        this.nitroUsesRemaining = NITRO_CONFIG.maxUses; // Reset to 2
      }
    }
  }

  // ── NITRO: AI Decision Logic ───────────────────────────────────────
  // Fully independent — NEVER checks if player used nitro.
  // Evaluates track conditions, race position, and race progress.
  shouldUseNitro(playerDistance, targetDistance) {
    if (!this.canActivateNitro()) return false;

    const strategy = this.nitroStrategy;

    // Too early in the race (randomized per bot)
    if (this.elapsed < this._nitroFirstUseTime) return false;

    // Decision cooldown active
    if (this.nitroDecisionTimer > 0) return false;

    // Don't use on steep slopes (unstable)
    if (Math.abs(this._currentSlope) > strategy.slopeThreshold) return false;

    const distDiff = playerDistance - this.distance; // positive = bot is behind

    // ── Condition 1: OVERTAKE — bot is behind player ──
    if (distDiff > strategy.overtakeThreshold) {
      return true;
    }

    // ── Condition 2: EXTEND LEAD — bot is ahead, push further away ──
    if (distDiff < -strategy.extendLeadThreshold && Math.abs(this._currentSlope) < 0.05) {
      // Only use 1 nitro for lead extension, save 1 for later
      if (this.nitroUsesRemaining >= 2) {
        return true;
      }
    }

    // ── Condition 3: FINAL PUSH — near race end ──
    if (targetDistance > 0) {
      const progressPercent = this.getDistanceMeters() / targetDistance;
      if (progressPercent >= strategy.finalPushPercent && this.nitroUsesRemaining > 0) {
        return true;
      }
    }

    // ── Condition 4: FLAT TERRAIN OPPORTUNITY — use on long straights ──
    if (Math.abs(this._currentSlope) < 0.03) {
      if (Math.random() < strategy.flatOpportunismChance) {
        return true;
      }
    }

    // ── Condition 5: SURPRISE HOT STREAK — random unpredictable nitro ──
    // Creates pressure and prevents player from predicting bot behavior
    if (Math.random() < strategy.hotStreakChance) {
      return true;
    }

    return false;
  }

  // ── NITRO: Speed multiplier (same as player) ──────────────────────
  getNitroSpeedMultiplier() {
    if (!this.nitroIsActive) return 1.0;
    return 1.0 + (NITRO_CONFIG.speedCapBoost - 1.0) * this.nitroIntensity;
  }

  // ── MAIN UPDATE ────────────────────────────────────────────────────
  update(delta, playerDistance, targetDistance) {
    if (this.isFinished) {
      this.ghost.update();
      return;
    }

    this.elapsed += delta;

    // Update nitro timers
    this.updateNitro(delta);

    // AI nitro decision (with reaction delay)
    if (this.nitroDecisionTimer > 0) {
      this.nitroDecisionTimer -= delta;
    } else {
      if (this.shouldUseNitro(playerDistance, targetDistance)) {
        this.activateNitro();
        this.nitroDecisionTimer = this.nitroStrategy.reactionDelay + Math.random() * 500;
      } else {
        this.nitroDecisionTimer = 200 + Math.random() * 200;
      }
    }

    // Gradual acceleration at race start
    let accelFactor = Math.min(1.0, this.elapsed / this.profile.accelDelay);
    accelFactor = accelFactor * accelFactor;

    // Base speed
    let speed = this.baseSpeed * accelFactor;

    // Natural speed fluctuation
    const fluctuationPeriod = 4000 + this._fluctuationOffset;
    const fluctuation = Math.sin(this.elapsed / fluctuationPeriod * Math.PI * 2);
    speed *= (1.0 + fluctuation * 0.06);

    // Slope detection — reduced penalties for competitive pacing
    if (this.terrain && this.terrain.getHeightAt) {
      const yAhead = this.terrain.getHeightAt(this.x + 50);
      const yHere = this.terrain.getHeightAt(this.x);
      const slope = (yHere - yAhead) / 50;
      this._currentSlope = slope;

      if (slope > 0.05) {
        speed *= (1.0 - this.profile.slopeSlowdown * Math.min(slope / 0.3, 1.0));
      } else if (slope < -0.05) {
        // Downhill boost (capped at 25%)
        speed *= (1.0 + Math.min(Math.abs(slope) * 0.4, 0.25));
      }
    }

    // ── Rubber banding (tighter deadzone for competitive races) ──
    const distanceDiff = playerDistance - this.distance;
    if (distanceDiff > 300) {
      // Bot is behind player — progressively stronger catch-up
      const behindFactor = Math.min((distanceDiff - 300) / 1500, 1.0);
      speed *= (1.0 + this.profile.rubberBandBoost * behindFactor);
    } else if (distanceDiff < -600) {
      // Bot is far ahead — gentle slowdown to keep race interesting
      const aheadFactor = Math.min((Math.abs(distanceDiff) - 600) / 2500, 1.0);
      speed *= (1.0 - this.profile.rubberBandSlow * aheadFactor);
    }

    // Mistakes — quick recovery, mild impact
    if (this.isMistaking) {
      speed *= this.profile.mistakeSlowdown;
      this.mistakeTimer += delta;
      if (this.mistakeTimer >= this.mistakeDuration) {
        this.isMistaking = false;
        this.mistakeTimer = 0;
      }
    } else if (Math.random() < this.profile.mistakeChance) {
      this.isMistaking = true;
      this.mistakeTimer = 0;
      this.mistakeDuration = this.profile.mistakeDurationMin +
        Math.random() * (this.profile.mistakeDurationMax - this.profile.mistakeDurationMin);
    }

    // Per-frame jitter (reduced to ±2% for smoother racing)
    speed *= (0.98 + Math.random() * 0.04);

    // ── MINIMUM SPEED FLOOR ──
    // Prevents bots from ever crawling due to stacked penalties
    const minSpeed = this.baseSpeed * (this.profile.minSpeedFactor || 0.60);
    speed = Math.max(speed, minSpeed);

    // ── NITRO BOOST (same multiplier as player) ──
    if (this.nitroIsActive) {
      speed *= this.getNitroSpeedMultiplier();
    }

    // ── STRICT SPEED CAP ──
    // Normal: 0.45 px/ms | With nitro: 0.72 px/ms (same as player cap)
    const absoluteMaxSpeed = this.nitroIsActive ? 0.72 : 0.45;
    speed = Math.min(speed, absoluteMaxSpeed);

    // Advance position
    this.currentSpeed = speed;
    this.distance += speed * delta;
    this.x = this.startX + this.distance;

    // Terrain Y position
    if (this.terrain && this.terrain.getHeightAt) {
      const terrainY = this.terrain.getHeightAt(this.x);
      this.y = terrainY - 20;

      const lookAhead = 30;
      const yNext = this.terrain.getHeightAt(this.x + lookAhead);
      this.rotation = Math.atan2(yNext - terrainY, lookAhead);
    }

    // Cosmetic coins
    if (Math.random() < 0.002) {
      this.totalCoins += 10;
    }

    // Check finish
    if (targetDistance && this.getDistanceMeters() >= targetDistance) {
      this.isFinished = true;
      this.finishTime = Math.round(this.elapsed / 1000);
    }

    // Feed position + nitro state to ghost for visual effects
    this.ghost.updateTarget({
      x: this.x,
      y: this.y,
      rotation: this.rotation,
      nitroActive: this.nitroIsActive,
      nitroIntensity: this.nitroIntensity
    });
    this.ghost.update();
  }

  getDistanceMeters() {
    return Math.round(this.distance / 10);
  }

  destroy() {
    if (this.ghost) {
      this.ghost.destroy();
      this.ghost = null;
    }
  }
}

// ============================================================================
// BotManager — Creates and manages all bot racers
// ============================================================================

export default class BotManager {
  constructor(scene, botPlayers, terrain, startX) {
    this.scene = scene;
    this.terrain = terrain;
    this.bots = [];

    for (const botData of botPlayers) {
      const bot = new BotRacer(scene, botData, terrain, startX);
      this.bots.push(bot);
    }
  }

  update(delta, playerDistance, targetDistance) {
    const playerDistancePx = playerDistance * 10;

    for (const bot of this.bots) {
      bot.update(delta, playerDistancePx, targetDistance);
    }
  }

  getRankings(playerDistance, playerName, playerCoins, playerFinished, playerFinishTime, playerGameOver, playerColor) {
    const entries = [];

    entries.push({
      id: 'solo-player',
      name: playerName,
      color: playerColor || '#00d4ff',
      distance: Math.round(playerDistance),
      coins: playerCoins || 0,
      finished: playerFinished || false,
      finishTime: playerFinishTime || 0,
      gameOver: playerGameOver || false,
      isBot: false
    });

    for (const bot of this.bots) {
      entries.push({
        id: bot.id,
        name: bot.name,
        color: bot.color,
        distance: bot.getDistanceMeters(),
        coins: bot.totalCoins,
        finished: bot.isFinished,
        finishTime: bot.finishTime,
        gameOver: false,
        isBot: true,
        difficulty: bot.difficulty
      });
    }

    entries.sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.distance - a.distance;
    });

    entries.forEach((e, i) => { e.rank = i + 1; });
    return entries;
  }

  getPlayerPosition(playerDistanceMeters) {
    let position = 1;
    for (const bot of this.bots) {
      if (bot.getDistanceMeters() > playerDistanceMeters) {
        position++;
      }
    }
    return { position, total: this.bots.length + 1 };
  }

  getLeaderboard(playerDistanceMeters, playerName) {
    const entries = [
      { id: 'solo-player', name: playerName, distance: playerDistanceMeters, color: '#00d4ff', isPlayer: true }
    ];

    for (const bot of this.bots) {
      entries.push({
        id: bot.id,
        name: bot.name,
        distance: bot.getDistanceMeters(),
        color: bot.color,
        isPlayer: false
      });
    }

    entries.sort((a, b) => b.distance - a.distance);
    entries.forEach((e, i) => { e.rank = i + 1; });
    return entries;
  }

  destroy() {
    for (const bot of this.bots) {
      bot.destroy();
    }
    this.bots = [];
  }
}
