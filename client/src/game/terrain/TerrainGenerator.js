// Procedural terrain generator using sine wave composition
// Creates terrain chunks and converts them to Matter.js bodies

export default class TerrainGenerator {
  constructor(scene, levelConfig) {
    this.scene = scene;
    this.config = levelConfig.terrain;
    this.colors = levelConfig.colors;
    this.chunks = [];
    this.chunkWidth = 800;
    this.pointSpacing = 15;
    this.lastGeneratedX = 0;
    this.terrainGraphics = scene.add.graphics();
    this.terrainGraphics.setDepth(5);
    this.terrainBodies = [];
    this.seed = Math.random() * 10000;

    // ── Rooftop Building Cache ──
    // Pre-generated building sequence for the 'building' terrain type.
    // Each entry: { startX, endX, roofY, gapAfter }
    this.buildings = [];
    this.buildingGenX = 0; // How far we've generated buildings

    if (this.config.type === 'building') {
      this._generateBuildingsUpTo(5000);
    }
  }

  // ── Seeded pseudo-random (deterministic per building index) ──
  _seededRandom(index) {
    const x = Math.sin(this.seed * 9301 + index * 4973) * 49297;
    return x - Math.floor(x);
  }

  // ── Generate building sequence up to a given X position ──
  _generateBuildingsUpTo(targetX) {
    while (this.buildingGenX < targetX) {
      const i = this.buildings.length; // building index
      const r = (n) => this._seededRandom(i * 7 + n); // scoped random

      // ── Progressive difficulty (0→1 over first 30 buildings) ──
      const progress = Math.min(i / 30, 1.0);

      // ── Building width: generous platforms that shrink gradually ──
      // Starts 550-750px, shrinks to 350-500px at max difficulty
      const minWidth = Math.max(350, 550 - progress * 200);
      const maxWidth = Math.max(500, 750 - progress * 250);
      const flatWidth = minWidth + r(0) * (maxWidth - minWidth);

      // ── Ramp dimensions ──
      // Takeoff ramp at the END of each building: 120px long, smooth sine curve
      const rampLength = 120;
      const rampHeight = 45; // max vertical lift at ramp tip

      // Landing slope at the START of each building: 80px gentle downslope
      const landingLength = 80;

      const totalWidth = flatWidth + rampLength + landingLength;

      // ── Building height (roofY) ──
      // KEY RULE: Each building is EQUAL or LOWER than the previous one.
      // This guarantees jumps are always achievable — you never jump upward.
      let roofY;
      if (i === 0) {
        roofY = 380; // First building: comfortable starting height
      } else {
        const prevRoof = this.buildings[i - 1].roofY;
        // Next building drops 0–60px based on difficulty (never goes UP)
        const maxDrop = 20 + progress * 40;
        const drop = r(2) * maxDrop;
        roofY = prevRoof + drop; // positive Y = lower on screen

        // Every 8th building, reset height back up to prevent going off-screen
        if (i % 8 === 0) {
          roofY = 350 + r(3) * 60;
        }
      }
      roofY = Math.max(250, Math.min(530, roofY)); // clamp to safe range

      // ── Gap after this building ──
      // Calibrated to be always jumpable at reasonable speed:
      //   At maxSpeed ~7.5px/frame, airtime ~30-50 frames = ~225-375px horizontal
      // So gaps must stay well under max jump distance
      const minGap = 120 + progress * 30;   // 120 → 150
      const maxGap = 200 + progress * 80;   // 200 → 280
      const gapAfter = minGap + r(1) * (maxGap - minGap);

      // First building starts right after the intro flat zone
      const startX = i === 0 ? 400 : this.buildingGenX;

      this.buildings.push({
        startX,
        endX: startX + totalWidth,
        roofY,
        gapAfter,
        rampLength,
        rampHeight,
        landingLength,
        flatWidth
      });

      this.buildingGenX = startX + totalWidth + gapAfter;
    }
  }

  // ── Get the building height at position x ──
  _getBuildingHeightAt(x) {
    // Ensure we have buildings generated far enough
    if (x > this.buildingGenX - 1000) {
      this._generateBuildingsUpTo(x + 5000);
    }

    for (const b of this.buildings) {
      if (x < b.startX) continue;
      if (x > b.endX + b.gapAfter) continue;

      // On this building's roof
      if (x >= b.startX && x <= b.endX) {
        const localX = x - b.startX;

        // ── Zone 1: Landing slope (first landingLength px) ──
        // Gentle downward slope for smooth arrival
        if (localX < b.landingLength) {
          const t = localX / b.landingLength; // 0 at start → 1 at end of landing
          // Sine ease: starts steep, flattens out into the roof
          const landingDrop = (1 - Math.sin(t * Math.PI * 0.5)) * 30;
          return b.roofY - landingDrop; // slightly above roof at start, eases down
        }

        // ── Zone 2: Flat rooftop (middle section) ──
        const flatEnd = b.landingLength + b.flatWidth;
        if (localX < flatEnd) {
          return b.roofY;
        }

        // ── Zone 3: Takeoff ramp (last rampLength px) ──
        // Smooth sine-curve ramp that provides natural upward trajectory
        const rampLocalX = localX - flatEnd;
        const t = rampLocalX / b.rampLength; // 0 at ramp start → 1 at edge
        // Sine-based curve: gradual start, smooth arc
        const rampLift = Math.sin(t * Math.PI * 0.5) * b.rampHeight;
        return b.roofY - rampLift;
      }

      // In the gap after this building — the abyss
      if (x > b.endX && x < b.endX + b.gapAfter) {
        return 750;
      }
    }

    // Before the first building (intro zone)
    return 400;
  }

  // ── Highway-specific terrain generation ──
  // 100% smooth sinusoidal curves — NO sharp edges, NO walls, NO abs().
  // Uses 6 layered sine waves at different wavelengths to create flowing
  // highway terrain with natural rhythm: calm → hilly → jump crest → calm.
  _getHighwayHeightAt(x) {
    const s = this.seed;

    // ── Progressive intensity: terrain gets hillier over distance ──
    const distProgress = Math.min((x - 400) / 25000, 1.0); // 0→1 over ~2500m
    const intensity = 1.0 + distProgress * 0.6; // amplitude grows 1.0 → 1.6

    // ── Layer 1: Grand sweeping hills (very long wavelength) ──
    // Creates the overall landscape — broad rises and dips
    const layer1 = Math.sin(x * 0.001 + s) * 50 * intensity;

    // ── Layer 2: Medium rolling hills (main driving rhythm) ──
    // This is the core "highway hill" feel — speed up downhill, slow uphill
    const layer2 = Math.sin(x * 0.003 + s * 1.7) * 40 * intensity;

    // ── Layer 3: Shorter bumps (creates natural jump crests at speed) ──
    // When these peaks align with layer 2 hills, you get smooth launch ramps
    const layer3 = Math.sin(x * 0.007 + s * 2.3) * 25 * intensity;

    // ── Layer 4: Subtle road texture (slight undulation) ──
    const layer4 = Math.sin(x * 0.012 + s * 0.9) * 10;

    // ── Layer 5: Very long-wavelength drift (prevents repetition) ──
    const layer5 = Math.cos(x * 0.0005 + s * 3.1) * 30;

    // ── Layer 6: Amplitude modulation — creates calm vs intense zones ──
    // This sine wave modulates layers 2+3, so some stretches are nearly flat
    // and others have pronounced hills — natural rhythm without sharp edges
    const ampMod = 0.5 + 0.5 * Math.sin(x * 0.0015 + s * 0.4);

    // Combine: layer1 + layer5 are always active (grand shape),
    // layer2 + layer3 are modulated for rhythm, layer4 is always subtle
    return layer1 + (layer2 + layer3) * ampMod + layer4 + layer5;
  }

  // Simple noise function using multiple sine waves
  noise(x) {
    const s = this.seed;
    const f = this.config.baseFrequency;
    const fv = this.config.frequencyVariation;
    const a = this.config.baseAmplitude;
    const av = this.config.amplitudeVariation;

    let value = 0;
    // Stretch the frequencies by multiplying by 0.6 so hills are wider and less sudden
    value += Math.sin(x * (f * 0.6) + s) * a;
    value += Math.sin(x * (f * 1.38) + s * 1.7) * (a * 0.5);
    value += Math.sin(x * (f * 0.3) + s * 0.3) * (av);
    value += Math.sin(x * (f * 2.22) + s * 2.1) * (av * 0.3);
    value += Math.cos(x * (fv * 1.2) + s * 0.8) * (av * 0.5);
    
    return value;
  }

  generateInitialTerrain() {
    // Generate terrain from before the start to well ahead
    const startX = -200;
    const endX = 2400;
    this.generateTerrainRange(startX, endX);
    this.lastGeneratedX = endX;
  }

  getHeightAt(x) {
    let y;
    if (x < 200) {
      y = 400; 
    } else if (x < 400) {
      const t = (x - 200) / 200;
      const flatY = 400;
      if (this.config.type === 'building') {
        // Smooth transition into first building
        const buildingY = this._getBuildingHeightAt(400);
        y = flatY + (buildingY - flatY) * (t * t);
      } else {
        const hillY = 400 + this.noise(x);
        y = flatY + (hillY - flatY) * (t * t);
      }
    } else {
      if (this.config.type === 'highway') {
        y = 400 + this._getHighwayHeightAt(x);
      } else if (this.config.type === 'crater') {
        const noiseVal = this.noise(x);
        // A crater is just an inverted absolute function!
        const craterNoise = Math.abs(noiseVal) * 1.5;
        y = 400 + craterNoise;
      } else if (this.config.type === 'building') {
        // Proper rooftop buildings with gaps
        y = this._getBuildingHeightAt(x);
      } else {
        const noiseVal = this.noise(x);
        // Classic hill overlapping
        y = 400 + noiseVal;
      }
    }
    
    // Allow much deeper/higher generation limits natively
    return Math.max(50, Math.min(850, y));
  }

  generateTerrainRange(startX, endX) {
    const points = [];
    
    for (let x = startX; x <= endX; x += this.pointSpacing) {
      points.push({ x, y: this.getHeightAt(x) });
    }

    // Draw terrain and create physics bodies
    this.drawTerrain(points);
    this.createTerrainBodies(points);
    
    this.chunks.push({
      startX,
      endX,
      points
    });
  }

  drawTerrain(points) {
    const g = this.terrainGraphics;
    const screenBottom = 800;

    if (this.config.type === 'building') {
      // ── BUILDING-SPECIFIC RENDERING ──
      // Draw each building as a separate filled rectangle/shape
      const fillColor = Phaser.Display.Color.HexStringToColor(this.colors.groundFill).color;
      const topColor = Phaser.Display.Color.HexStringToColor(this.colors.groundTop).color;
      const darkColor = Phaser.Display.Color.HexStringToColor(this.colors.groundDark).color;

      // Split points into building segments (contiguous roof points where y < 700)
      let segments = [];
      let currentSeg = [];

      for (let i = 0; i < points.length; i++) {
        if (points[i].y < 700) {
          currentSeg.push(points[i]);
        } else {
          if (currentSeg.length > 1) {
            segments.push(currentSeg);
          }
          currentSeg = [];
        }
      }
      if (currentSeg.length > 1) segments.push(currentSeg);

      // Draw each building segment
      for (const seg of segments) {
        // Building body fill
        g.beginPath();
        g.moveTo(seg[0].x, screenBottom);
        for (let i = 0; i < seg.length; i++) {
          g.lineTo(seg[i].x, seg[i].y);
        }
        g.lineTo(seg[seg.length - 1].x, screenBottom);
        g.closePath();
        g.fillStyle(fillColor, 1);
        g.fill();

        // Building wall lines (vertical edges)
        g.lineStyle(2, darkColor, 0.8);
        g.lineBetween(seg[0].x, seg[0].y, seg[0].x, screenBottom);
        g.lineBetween(seg[seg.length-1].x, seg[seg.length-1].y, seg[seg.length-1].x, screenBottom);

        // Neon-lit rooftop edge
        g.lineStyle(4, topColor, 1);
        g.beginPath();
        g.moveTo(seg[0].x, seg[0].y);
        for (let i = 1; i < seg.length; i++) {
          g.lineTo(seg[i].x, seg[i].y);
        }
        g.strokePath();

        // Window details on building face
        const bStartX = seg[0].x;
        const bEndX = seg[seg.length - 1].x;
        const bTopY = Math.min(...seg.map(p => p.y));
        const windowColor = 0xFFD700; // warm window glow

        for (let wx = bStartX + 20; wx < bEndX - 20; wx += 40) {
          for (let wy = bTopY + 30; wy < screenBottom - 30; wy += 45) {
            const lit = this._seededRandom(Math.floor(wx * 31 + wy * 17)) > 0.4;
            if (lit) {
              g.fillStyle(windowColor, 0.15 + this._seededRandom(Math.floor(wx + wy)) * 0.2);
              g.fillRect(wx, wy, 12, 16);
            }
          }
        }
      }

      return; // Skip default terrain drawing
    }

    // ── DEFAULT TERRAIN RENDERING (hills, highway, crater) ──
    // Draw filled terrain
    g.beginPath();
    g.moveTo(points[0].x, screenBottom);
    
    for (let i = 0; i < points.length; i++) {
      g.lineTo(points[i].x, points[i].y);
    }
    
    g.lineTo(points[points.length - 1].x, screenBottom);
    g.closePath();
    g.fillStyle(Phaser.Display.Color.HexStringToColor(this.colors.groundFill).color, 1);
    g.fill();

    // Draw terrain surface line (grass/ground top)
    g.lineStyle(4, Phaser.Display.Color.HexStringToColor(this.colors.groundTop).color, 1);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      g.lineTo(points[i].x, points[i].y);
    }
    g.strokePath();

    // Draw darker base layer
    g.beginPath();
    g.moveTo(points[0].x, screenBottom);
    for (let i = 0; i < points.length; i++) {
      g.lineTo(points[i].x, points[i].y + 30);
    }
    g.lineTo(points[points.length - 1].x, screenBottom);
    g.closePath();
    g.fillStyle(Phaser.Display.Color.HexStringToColor(this.colors.groundDark).color, 0.5);
    g.fill();
  }

  createTerrainBodies(points) {
    // Create terrain segments as static rectangle bodies tilted to match surface
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      // For building terrain, skip physics bodies in gap zones (deep drop)
      // so the car actually falls through the gap
      if (this.config.type === 'building' && p1.y >= 700 && p2.y >= 700) {
        continue;
      }
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      const body = this.scene.matter.add.rectangle(midX, midY + 15, length + 2, 30, {
        isStatic: true,
        angle: angle,
        friction: 0.8,
        restitution: 0.1,
        label: 'terrain',
        chamfer: { radius: 2 }
      });

      this.terrainBodies.push(body);
    }
  }

  update(cameraX) {
    // Generate new terrain ahead of camera
    const generateAhead = 1600;
    if (cameraX + generateAhead > this.lastGeneratedX) {
      const newStart = this.lastGeneratedX;
      const newEnd = this.lastGeneratedX + this.chunkWidth;
      this.generateTerrainRange(newStart, newEnd);
      this.lastGeneratedX = newEnd;
    }

    // Clean up old chunks far behind camera
    const cleanupBehind = 2000;
    this.chunks = this.chunks.filter(chunk => {
      if (chunk.endX < cameraX - cleanupBehind) {
        // Remove physics bodies for this chunk
        // We don't track bodies per chunk precisely, so we skip cleanup
        // to avoid complexity. Bodies far behind won't affect performance much.
        return false;
      }
      return true;
    });
  }

  destroy() {
    if (this.terrainGraphics) {
      this.terrainGraphics.destroy();
    }
    this.terrainBodies.forEach(body => {
      this.scene.matter.world.remove(body);
    });
    this.terrainBodies = [];
    this.chunks = [];
  }
}
