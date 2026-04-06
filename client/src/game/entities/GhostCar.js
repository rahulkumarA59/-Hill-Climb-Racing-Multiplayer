// Ghost car - visual only representation of other players
// Uses interpolation for smooth movement
// Supports nitro visual feedback (glow + flame trail)

import Phaser from 'phaser';

export default class GhostCar {
  constructor(scene, playerData) {
    this.scene = scene;
    this.id = playerData.id;
    this.name = playerData.name;
    this.color = playerData.color || '#2ed573';
    this.vehicleType = playerData.vehicle || 'car';

    this.currentX = 0;
    this.currentY = 0;
    this.currentRotation = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.targetRotation = 0;
    this.lerpSpeed = 0.15;

    // Nitro visual state
    this.nitroActive = false;
    this.nitroIntensity = 0;
    this.nitroParticles = [];

    // Chassis graphics (with position + rotation)
    this.chassisGfx = scene.add.graphics();
    this.chassisGfx.setDepth(8);
    this.chassisGfx.setAlpha(0.65);

    // Wheel graphics (absolute positions)
    this.wheelGfx = scene.add.graphics();
    this.wheelGfx.setDepth(7);
    this.wheelGfx.setAlpha(0.65);

    // Nitro effect graphics (rendered above ghost)
    this.nitroGfx = scene.add.graphics();
    this.nitroGfx.setDepth(9);

    // Name label
    this.nameLabel = scene.add.text(0, 0, this.name, {
      fontSize: '12px',
      fontFamily: 'Arial',
      color: this.color,
      stroke: '#000000',
      strokeThickness: 3,
      align: 'center'
    });
    this.nameLabel.setOrigin(0.5, 1);
    this.nameLabel.setDepth(12);
  }

  updateTarget(data) {
    this.targetX = data.x;
    this.targetY = data.y;
    this.targetRotation = data.rotation || 0;

    // Nitro state from BotManager
    if (data.nitroActive !== undefined) {
      this.nitroActive = data.nitroActive;
      this.nitroIntensity = data.nitroIntensity || 0;
    }
  }

  update() {
    // Smooth interpolation
    this.currentX += (this.targetX - this.currentX) * this.lerpSpeed;
    this.currentY += (this.targetY - this.currentY) * this.lerpSpeed;

    let rotDiff = this.targetRotation - this.currentRotation;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    this.currentRotation += rotDiff * this.lerpSpeed;

    this.draw();
    this.drawNitroEffects();
    this.nameLabel.setPosition(this.currentX, this.currentY - 50);
  }

  draw() {
    const x = this.currentX;
    const y = this.currentY;
    const angle = this.currentRotation;
    const colorNum = Phaser.Display.Color.HexStringToColor(this.color).color;

    // Chassis - use setPosition + setRotation
    const cg = this.chassisGfx;
    cg.clear();
    cg.setPosition(x, y);
    cg.setRotation(angle);

    if (this.vehicleType === 'bike') {
      cg.fillStyle(colorNum, 0.7);
      // Ghost Bike Frame
      cg.beginPath();
      cg.moveTo(5, -18);
      cg.lineTo(20, -18);
      cg.lineTo(28, -6);
      cg.lineTo(5, -6);
      cg.fill();
      
      cg.beginPath();
      cg.moveTo(-25, -18);
      cg.lineTo(-10, -18);
      cg.lineTo(-10, -10);
      cg.lineTo(-25, -12);
      cg.fill();

      // Ghost Rider (simple)
      cg.fillStyle(colorNum, 0.5);
      cg.fillRoundedRect(-8, -35, 12, 20, 4);
      cg.fillCircle(-2, -40, 7);

    } else {
      // Ghost Car
      cg.fillStyle(colorNum, 0.7);
      cg.fillRoundedRect(-45, -14, 90, 28, 6);

      cg.fillStyle(colorNum, 0.5);
      cg.fillRoundedRect(-20, -32, 45, 20, 5);

      cg.fillStyle(0x87CEEB, 0.5);
      cg.fillRoundedRect(-15, -29, 16, 14, 3);
      cg.fillRoundedRect(5, -29, 16, 14, 3);
    }

    // Wheels at estimated positions
    const wg = this.wheelGfx;
    wg.clear();

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    let frontWX, frontWY, rearWX, rearWY, wheelRad;
    
    if (this.vehicleType === 'bike') {
      frontWX = x + cos * 25 + sin * 10;
      frontWY = y + sin * 25 - cos * (-10);
      rearWX = x - cos * 25 + sin * 10;
      rearWY = y - sin * 25 - cos * (-10);
      wheelRad = 15;
    } else {
      frontWX = x + cos * 32 + sin * 20;
      frontWY = y + sin * 32 - cos * (-20);
      rearWX = x - cos * 32 + sin * 20;
      rearWY = y - sin * 32 - cos * (-20);
      wheelRad = 14;
    }

    wg.fillStyle(0x333333, 0.7);
    wg.fillCircle(frontWX, frontWY, wheelRad);
    wg.fillCircle(rearWX, rearWY, wheelRad);

    wg.fillStyle(0x999999, 0.5);
    wg.fillCircle(frontWX, frontWY, 8);
    wg.fillCircle(rearWX, rearWY, 8);
  }

  // ── NITRO VISUAL EFFECTS ─────────────────────────────────────────────

  drawNitroEffects() {
    const ng = this.nitroGfx;
    ng.clear();

    // Update existing particles
    for (let i = this.nitroParticles.length - 1; i >= 0; i--) {
      const p = this.nitroParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.01;
      p.life -= p.decay;
      p.size *= 0.95;

      if (p.life <= 0 || p.size < 0.3) {
        this.nitroParticles.splice(i, 1);
        continue;
      }

      // Color: cyan → blue → purple
      let color;
      if (p.life > 0.7) color = 0x00FFFF;
      else if (p.life > 0.4) color = 0x4488FF;
      else color = 0x8844FF;

      ng.fillStyle(color, p.life * 0.6);
      ng.fillCircle(p.x, p.y, p.size);

      if (p.life > 0.5) {
        ng.fillStyle(0xFFFFFF, p.life * 0.3);
        ng.fillCircle(p.x, p.y, p.size * 0.35);
      }
    }

    // Spawn new particles if nitro is active
    if (this.nitroActive && this.nitroIntensity > 0) {
      const x = this.currentX;
      const y = this.currentY;
      const angle = this.currentRotation;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Flame trail behind the vehicle
      for (let i = 0; i < 2; i++) {
        const spread = (Math.random() - 0.5) * 6;
        this.nitroParticles.push({
          x: x - cos * 45 + sin * spread,
          y: y - sin * 45 - cos * spread,
          vx: -cos * (3 + Math.random() * 4) * this.nitroIntensity,
          vy: -sin * (3 + Math.random() * 4) * this.nitroIntensity - Math.random() * 1.5,
          life: 1.0,
          decay: 0.05 + Math.random() * 0.04,
          size: (3 + Math.random() * 5) * this.nitroIntensity,
        });
      }

      // Glow around the ghost vehicle
      const glowAlpha = 0.12 * this.nitroIntensity;
      ng.fillStyle(0x00FFFF, glowAlpha);
      ng.fillCircle(x, y, 55);
      ng.fillStyle(0x4488FF, glowAlpha * 0.5);
      ng.fillCircle(x, y, 80);
    }

    // Cap particles
    if (this.nitroParticles.length > 40) {
      this.nitroParticles.splice(0, this.nitroParticles.length - 40);
    }
  }

  destroy() {
    if (this.chassisGfx) { this.chassisGfx.destroy(); this.chassisGfx = null; }
    if (this.wheelGfx) { this.wheelGfx.destroy(); this.wheelGfx = null; }
    if (this.nitroGfx) { this.nitroGfx.destroy(); this.nitroGfx = null; }
    if (this.nameLabel) { this.nameLabel.destroy(); this.nameLabel = null; }
    this.nitroParticles = [];
  }
}
