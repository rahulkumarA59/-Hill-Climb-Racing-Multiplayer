// ============================================================================
// NitroSystem.js — Nitro Boost Controller
// ============================================================================
// Manages nitro usage, cooldowns, and effects.
//
// Rules:
//   • 2 uses per cycle → then 45s cooldown
//   • Minimum 3s gap between consecutive uses
//   • 2.5s boost duration per use
//   • Smooth ramp-up/ramp-down of boost
//   • Angular stabilization during boost to prevent flipping
//   • No stacking — second use waits for first to finish
// ============================================================================

import { NITRO_CONFIG } from '../PhysicsConfig.js';

export default class NitroSystem {
  constructor(scene) {
    this.scene = scene;
    this.config = { ...NITRO_CONFIG };

    // State
    this.usesRemaining = this.config.maxUses;       // 2
    this.isActive = false;                           // Currently boosting?
    this.isCooldown = false;                         // In 45s cooldown?
    this.boostTimer = 0;                             // ms remaining on current boost
    this.gapTimer = 0;                               // ms remaining before next use allowed
    this.cooldownTimer = 0;                          // ms remaining on 45s cooldown

    // Smooth boost intensity (0 → 1 ramp up, 1 → 0 ramp down)
    this.intensity = 0;

    // Visual particles
    this.nitroParticles = [];
  }

  // ─── CAN ACTIVATE? ──────────────────────────────────────────────────

  canActivate() {
    if (this.isActive) return false;          // Already boosting
    if (this.isCooldown) return false;         // In cooldown
    if (this.usesRemaining <= 0) return false; // No uses left
    if (this.gapTimer > 0) return false;       // Too soon after last use
    return true;
  }

  // ─── ACTIVATE NITRO ─────────────────────────────────────────────────

  activate() {
    if (!this.canActivate()) return false;

    this.usesRemaining--;
    this.isActive = true;
    this.boostTimer = this.config.boostDuration; // 2500ms
    this.intensity = 0; // Will ramp up smoothly

    // Play activation sound
    if (this.scene.soundManager) {
      this.scene.soundManager.playNitroSound?.();
    }

    return true;
  }

  // ─── UPDATE (called every frame) ────────────────────────────────────

  update(delta) {
    // ── Active boost logic ──
    if (this.isActive) {
      this.boostTimer -= delta;

      // Smooth ramp-up (first 300ms) and ramp-down (last 500ms)
      const elapsed = this.config.boostDuration - this.boostTimer;
      const rampUpDuration = 300;
      const rampDownStart = this.config.boostDuration - 500;

      if (elapsed < rampUpDuration) {
        // Ramp up
        this.intensity = Math.min(1, elapsed / rampUpDuration);
      } else if (this.boostTimer < 500) {
        // Ramp down
        this.intensity = Math.max(0, this.boostTimer / 500);
      } else {
        this.intensity = 1;
      }

      // Boost expired
      if (this.boostTimer <= 0) {
        this.isActive = false;
        this.intensity = 0;
        this.boostTimer = 0;

        // Set gap timer (3s before next use allowed)
        this.gapTimer = this.config.gapBetweenUses;

        // If all uses exhausted, start cooldown
        if (this.usesRemaining <= 0) {
          this.isCooldown = true;
          this.cooldownTimer = this.config.cooldownDuration; // 45000ms
          this.gapTimer = 0; // No gap needed, cooldown handles it
        }
      }
    }

    // ── Gap timer ──
    if (this.gapTimer > 0) {
      this.gapTimer -= delta;
      if (this.gapTimer <= 0) this.gapTimer = 0;
    }

    // ── Cooldown timer ──
    if (this.isCooldown) {
      this.cooldownTimer -= delta;
      if (this.cooldownTimer <= 0) {
        this.isCooldown = false;
        this.cooldownTimer = 0;
        this.usesRemaining = this.config.maxUses; // Reset to 2
      }
    }

    // ── Update nitro particles ──
    this.updateParticles(delta);
  }

  // ─── GETTERS FOR PHYSICS ────────────────────────────────────────────

  /** Returns current force multiplier (1.0 = no boost, up to forceMultiplier) */
  getForceMultiplier() {
    if (!this.isActive) return 1.0;
    return 1.0 + (this.config.forceMultiplier - 1.0) * this.intensity;
  }

  /** Returns current max speed multiplier */
  getSpeedCapMultiplier() {
    if (!this.isActive) return 1.0;
    return 1.0 + (this.config.speedCapBoost - 1.0) * this.intensity;
  }

  /** Returns angular stabilization factor (lower = more stable) */
  getStabilizationFactor() {
    if (!this.isActive) return 1.0;
    return 1.0 - (1.0 - this.config.stabilization) * this.intensity;
  }

  // ─── HUD DATA ───────────────────────────────────────────────────────

  getHudData() {
    return {
      usesRemaining: this.usesRemaining,
      maxUses: this.config.maxUses,
      isActive: this.isActive,
      isCooldown: this.isCooldown,
      cooldownRemaining: Math.ceil(this.cooldownTimer / 1000),
      cooldownTotal: this.config.cooldownDuration / 1000,
      intensity: this.intensity,
      canActivate: this.canActivate(),
      gapRemaining: Math.ceil(this.gapTimer / 1000),
      boostRemaining: Math.ceil(this.boostTimer / 1000),
    };
  }

  // ─── VISUAL EFFECTS ─────────────────────────────────────────────────

  spawnNitroFlame(x, y, angle) {
    if (!this.isActive) return;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Spawn flame/trail particles behind the vehicle
    for (let i = 0; i < 3; i++) {
      const spread = (Math.random() - 0.5) * 8;
      this.nitroParticles.push({
        x: x - cos * 50 + sin * spread,
        y: y - sin * 50 - cos * spread,
        vx: -cos * (4 + Math.random() * 6) * this.intensity,
        vy: -sin * (4 + Math.random() * 6) * this.intensity - Math.random() * 2,
        life: 1.0,
        decay: 0.04 + Math.random() * 0.03,
        size: (4 + Math.random() * 6) * this.intensity,
        phase: Math.random(), // For color interpolation
      });
    }
  }

  updateParticles(delta) {
    for (let i = this.nitroParticles.length - 1; i >= 0; i--) {
      const p = this.nitroParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.01;
      p.life -= p.decay;
      p.size *= 0.96;

      if (p.life <= 0 || p.size < 0.3) {
        this.nitroParticles.splice(i, 1);
      }
    }

    // Cap particles
    if (this.nitroParticles.length > 80) {
      this.nitroParticles.splice(0, this.nitroParticles.length - 80);
    }
  }

  drawParticles(graphics) {
    for (const p of this.nitroParticles) {
      // Color gradient: bright cyan → blue → purple based on life
      let color;
      if (p.life > 0.7) {
        color = 0x00FFFF; // Cyan (hottest)
      } else if (p.life > 0.4) {
        color = 0x4488FF; // Blue
      } else {
        color = 0x8844FF; // Purple (coolest)
      }

      graphics.fillStyle(color, p.life * 0.8);
      graphics.fillCircle(p.x, p.y, p.size);

      // Inner glow
      if (p.life > 0.5) {
        graphics.fillStyle(0xFFFFFF, p.life * 0.4);
        graphics.fillCircle(p.x, p.y, p.size * 0.4);
      }
    }
  }

  // ─── RESET ──────────────────────────────────────────────────────────

  reset() {
    this.usesRemaining = this.config.maxUses;
    this.isActive = false;
    this.isCooldown = false;
    this.boostTimer = 0;
    this.gapTimer = 0;
    this.cooldownTimer = 0;
    this.intensity = 0;
    this.nitroParticles = [];
  }

  destroy() {
    this.nitroParticles = [];
  }
}
