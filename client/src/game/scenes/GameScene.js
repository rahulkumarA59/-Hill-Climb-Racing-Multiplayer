import Phaser from 'phaser';
import Car from '../entities/Car';
import Bike from '../entities/Bike';
import GhostCar from '../entities/GhostCar';
import BotManager from '../entities/BotManager';
import TerrainGenerator from '../terrain/TerrainGenerator';
import LEVEL_CONFIGS from '../levels/LevelConfig';
import { CAR_PHYSICS, BIKE_PHYSICS, ITEM_CONFIG, NITRO_CONFIG } from '../PhysicsConfig';
import EventBus from '../../EventBus';
import { soundManager } from '../audio/SoundManager';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    this.level = this.registry.get('level') || 1;
    this.players = this.registry.get('players') || [];
    this.socket = this.registry.get('socket');
    this.myId = this.registry.get('myId');
    this.levelConfig = LEVEL_CONFIGS[this.level];

    // Game state
    this.isGameOver = false;
    this.isPaused = false;
    this.isPausedByUser = false;
    this.updateCounter = 0;
    this.ghostCars = new Map();

    // Audio
    this.soundManager = soundManager;
    this.soundManager.init(); // Initialize audio context

    // Fuel system
    this.fuel = 100;
    this.maxFuel = 100;
    this.fuelConsumptionRate = 0.04; // per frame when accelerating
    this.fuelIdleRate = 0.005; // slow drain even when idle

    // Coins/pickups
    this.coins = [];
    this.coinScore = 0;

    // Item generation tracking
    this.totalFuelBurned = 0.001; // Avoid divide by zero
    this.nextClusterX = 500; 
    this.nextFuelX = 800; // First fuel out
    this.lastSpawnedFuelX = 0;

    // Particles
    this.exhaustParticles = [];

    // Set gravity per level
    this.matter.world.setGravity(0, this.levelConfig.gravity);

    // Set collision categories
    this.terrainCategory = 0x0001;
    this.carCategory = 0x0002;

    // Create parallax background
    this.createBackground();

    // Create terrain
    this.terrain = new TerrainGenerator(this, this.levelConfig);
    this.terrain.generateInitialTerrain();

    // Create player vehicle (Car or Bike) with merged physics config
    const myPlayer = this.players.find(p => p.id === this.myId);
    const vehicleType = myPlayer?.vehicle || 'car';
    const basePhysics = vehicleType === 'bike' ? BIKE_PHYSICS : CAR_PHYSICS;
    const levelPhysics = this.levelConfig.physics || {};
    this.mergedPhysics = { ...basePhysics, ...levelPhysics };

    try {
      if (vehicleType === 'bike') {
        this.car = new Bike(this, 100, 340, myPlayer?.color || '#ff4757', this.mergedPhysics);
      } else {
        this.car = new Car(this, 100, 340, myPlayer?.color || '#ff4757', this.mergedPhysics);
      }
    } catch (e) {
      console.error("VEHICLE LOAD ERROR:", e);
      const errText = this.add.text(10, 10, e.stack || e.toString(), {
        fontSize: '16px', color: '#ff0000', backgroundColor: '#ffffff', wordWrap: { width: 1200 }
      });
      errText.setScrollFactor(0);
      errText.setDepth(9999);
      this.car = null; // Prevent update loop crashes
    }

    // Set terrain collision categories
    this.matter.world.getAllBodies().forEach(body => {
      if (body.label === 'terrain') {
        body.collisionFilter.category = this.terrainCategory;
        body.collisionFilter.mask = this.carCategory;
      }
    });

    // Detect Ragdoll Head Crash (Chassis hitting ground while flipped)
    this.matter.world.on('collisionstart', (event) => {
      if (this.isGameOver) return;
      for (let i = 0; i < event.pairs.length; i++) {
        const { bodyA, bodyB } = event.pairs[i];
        const isChassisHit = (bodyA.label === 'chassis' && bodyB.label === 'terrain') || 
                             (bodyB.label === 'chassis' && bodyA.label === 'terrain');
                             
        if (isChassisHit) {
           // Ensure it's roughly upside down (angle > 1.5 rads is ~85 degrees)
           const angle = Math.abs(this.car.chassis.angle % (Math.PI * 2));
           if ((angle > 1.5 && angle < 4.8) || (angle < -1.5 && angle > -4.8)) {
               this.handleGameOver('flipped');
               break;
           }
        }
      }
    });

    // Set initial camera
    const initPos = this.car.getPosition();
    this.cameras.main.scrollX = initPos.x - 350;
    this.cameras.main.scrollY = initPos.y - 300;

    // Ghost cars (multiplayer only — not used in bots mode)
    this.isBotMode = this.players.some(p => p.isBot);
    if (!this.isBotMode) {
      this.players.forEach(p => {
        if (p.id !== this.myId) {
          const ghost = new GhostCar(this, p);
          this.ghostCars.set(p.id, ghost);
        }
      });
    }

    // Bot Manager (bots mode only)
    this.botManager = null;
    if (this.isBotMode) {
      const botPlayers = this.players.filter(p => p.isBot);
      const startX = this.car ? this.car.startX || 100 : 100;
      this.botManager = new BotManager(this, botPlayers, this.terrain, startX);
    }

    // Camera dummy
    this.cameras.main.stopFollow();

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
    };
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Socket listeners
    this.setupSocketListeners();

    // HUD update timer
    this.hudUpdateTimer = 0;

    // Distance markers
    this.distanceMarkers = this.add.graphics();
    this.distanceMarkers.setDepth(4);
    this.lastMarkerX = 0;

    // Particle graphics
    this.particleGfx = this.add.graphics();
    this.particleGfx.setDepth(7);

    // Nitro flame graphics (rendered above vehicle)
    this.nitroGfx = this.add.graphics();
    this.nitroGfx.setDepth(11);

    // Coin graphics
    this.coinGfx = this.add.graphics();
    this.coinGfx.setDepth(6);

    // Initial item generation state
    this.nextFuelX = ITEM_CONFIG.fuelSpawnDistanceDefault;
    this.generateItems(3000);

    // Countdown before start
    this.showCountdown();

    // Airborne Gameplay Mechanics: Reward Flips
    this.events.on('airFlipCompleted', (data) => {
      this.coinScore += data.reward;
      const trickName = data.flips > 1 ? `SUPER FLIP x${data.flips}` : "PERFECT FLIP";
      this.showPickupText(data.x, data.y, `${trickName}! +${data.reward} 🪙`, '#ff9f43');
      
      // Give them a satisfying sound bonus for landing it
      this.soundManager.playCoinSound();
    });

    // Wheelie Reward System (Bike only — 250 coins per second of sustained wheelie)
    this.events.on('coinSpawned', (data) => {
      this.coinScore += data.value;
      this.showPickupText(data.x, data.y, `WHEELIE! +${data.value} 🪙`, '#f9ca24');
      this.soundManager.playCoinSound();
    });

    // Pause / Resume listeners from React UI
    this._onPauseGame = () => this.pauseGame();
    this._onResumeGame = () => this.resumeGame();
    EventBus.on('pauseGame', this._onPauseGame);
    EventBus.on('resumeGame', this._onResumeGame);
  }

  createBackground() {
    const width = 1280;
    const height = 720;
    const colors = this.levelConfig.colors;

    // Sky gradient
    this.skyGraphics = this.add.graphics();
    this.skyGraphics.setDepth(0);
    this.skyGraphics.setScrollFactor(0);

    const skyColors = colors.sky;
    const topColor = Phaser.Display.Color.HexStringToColor(skyColors[0]).color;
    const midColor = Phaser.Display.Color.HexStringToColor(skyColors[1]).color;
    const bottomColor = Phaser.Display.Color.HexStringToColor(skyColors[2]).color;

    for (let y = 0; y < height; y++) {
      const t = y / height;
      let color;
      if (t < 0.5) {
        const lt = t * 2;
        color = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(topColor),
          Phaser.Display.Color.ValueToColor(midColor),
          100, Math.floor(lt * 100)
        );
      } else {
        const lt = (t - 0.5) * 2;
        color = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(midColor),
          Phaser.Display.Color.ValueToColor(bottomColor),
          100, Math.floor(lt * 100)
        );
      }
      this.skyGraphics.lineStyle(1, Phaser.Display.Color.GetColor(color.r, color.g, color.b));
      this.skyGraphics.lineBetween(0, y, width, y);
    }

    // Sun/moon
    const sunGfx = this.add.graphics();
    sunGfx.setDepth(0);
    sunGfx.setScrollFactor(0);
    if (this.level === 3) {
      // Lava glow for volcanic level
      sunGfx.fillStyle(0xFF4500, 0.3);
      sunGfx.fillCircle(900, 120, 60);
      sunGfx.fillStyle(0xFF6347, 0.5);
      sunGfx.fillCircle(900, 120, 35);
      sunGfx.fillStyle(0xFF8C00, 0.8);
      sunGfx.fillCircle(900, 120, 20);
    } else {
      // Sun
      sunGfx.fillStyle(0xFFE066, 0.3);
      sunGfx.fillCircle(1000, 100, 60);
      sunGfx.fillStyle(0xFFE066, 0.5);
      sunGfx.fillCircle(1000, 100, 40);
      sunGfx.fillStyle(0xFFF4B0, 0.8);
      sunGfx.fillCircle(1000, 100, 25);
    }

    // Mountain layer 1 (far)
    const mountainColor = Phaser.Display.Color.HexStringToColor(colors.mountain).color;
    this.mountainGraphics = this.add.graphics();
    this.mountainGraphics.setDepth(1);
    this.mountainGraphics.setScrollFactor(0.15, 0);

    this.mountainGraphics.fillStyle(mountainColor, 0.5);
    this.mountainGraphics.beginPath();
    this.mountainGraphics.moveTo(-400, height);
    for (let x = -400; x <= width + 800; x += 30) {
      const my = 280 + Math.sin(x * 0.004) * 90 + Math.sin(x * 0.011) * 50 + Math.sin(x * 0.002) * 70;
      this.mountainGraphics.lineTo(x, my);
    }
    this.mountainGraphics.lineTo(width + 800, height);
    this.mountainGraphics.closePath();
    this.mountainGraphics.fill();

    // Mountain layer 2 (mid)
    this.mountainGraphics2 = this.add.graphics();
    this.mountainGraphics2.setDepth(2);
    this.mountainGraphics2.setScrollFactor(0.3, 0);

    this.mountainGraphics2.fillStyle(mountainColor, 0.35);
    this.mountainGraphics2.beginPath();
    this.mountainGraphics2.moveTo(-400, height);
    for (let x = -400; x <= width + 800; x += 25) {
      const my = 360 + Math.sin(x * 0.007 + 2) * 55 + Math.sin(x * 0.014 + 1) * 35;
      this.mountainGraphics2.lineTo(x, my);
    }
    this.mountainGraphics2.lineTo(width + 800, height);
    this.mountainGraphics2.closePath();
    this.mountainGraphics2.fill();

    // Clouds
    this.clouds = [];
    for (let i = 0; i < 8; i++) {
      const cloud = this.add.graphics();
      cloud.setDepth(1);
      cloud.setScrollFactor(0.08 + Math.random() * 0.08, 0);
      const cx = Math.random() * (width + 600) - 300;
      const cy = 40 + Math.random() * 180;
      const scale = 0.4 + Math.random() * 0.9;

      cloud.fillStyle(0xFFFFFF, 0.2 + Math.random() * 0.15);
      cloud.fillEllipse(cx, cy, 110 * scale, 40 * scale);
      cloud.fillEllipse(cx + 35 * scale, cy - 12 * scale, 80 * scale, 35 * scale);
      cloud.fillEllipse(cx - 30 * scale, cy + 5 * scale, 70 * scale, 30 * scale);
      cloud.fillEllipse(cx + 60 * scale, cy + 3 * scale, 55 * scale, 25 * scale);

      this.clouds.push(cloud);
    }
  }

  generateItems(endX) {
    // Generate coin clusters
    while (this.nextClusterX < endX) {
      // Prevent coin overlap with fuel
      if (Math.abs(this.nextClusterX - this.nextFuelX) > 300) {
        this.spawnCoinCluster(this.nextClusterX);
      }
      // Cluster Spacing: random(75m to 150m) = 750px to 1500px
      const gap = Phaser.Math.Between(750, 1500); 
      this.nextClusterX += gap;
    }
  }

  getSafeY(x) {
    const terrainY = this.terrain.getHeightAt ? this.terrain.getHeightAt(x) : 400;
    // FIXED OFFSET rule with optional slight arc (±5px max)
    let y = terrainY - 25 + Phaser.Math.Between(-5, 5);

    // Hard Validation Rule (Mandatory)
    if (y >= terrainY) {
      y = terrainY - 25;
    }
    if (y < terrainY - 60) {
      y = terrainY - 40;
    }
    return y;
  }

  getSafeFuelX(targetX) {
    // Scan up to 2000px forward to find a flat spot
    for (let x = targetX; x < targetX + 2000; x += 50) {
      const y1 = this.terrain.getHeightAt ? this.terrain.getHeightAt(x) : 0;
      const y2 = this.terrain.getHeightAt ? this.terrain.getHeightAt(x + 50) : 0;
      const slope = Math.abs((y2 - y1) / 50);
      
      // Check if this segment's slope is flat enough
      if (slope <= ITEM_CONFIG.maxFuelSlope) {
        return x; 
      }
    }
    
    // SAFETY OVERRIDE: If we scanned 2000px and found NO flat spot whatsoever,
    // we MUST spawn the fuel anyway so the player has a fighting chance.
    return targetX;
  }

  spawnCoinCluster(startX) {
    const clusterSize = Phaser.Math.Between(3, 7);
    let currentX = startX;

    // Available coin values in descending order
    const COIN_VALUES = [100, 50, 25, 10, 5];

    // Weighted probability for starting value index (higher values are rarer)
    // Index: 0=100, 1=50, 2=25, 3=10, 4=5
    const startWeights = [0.05, 0.12, 0.25, 0.35, 0.23]; // sum = 1.0
    let roll = Math.random();
    let startIdx = COIN_VALUES.length - 1;
    let cumulative = 0;
    for (let i = 0; i < startWeights.length; i++) {
      cumulative += startWeights[i];
      if (roll <= cumulative) { startIdx = i; break; }
    }

    let currentIdx = startIdx;

    for (let i = 0; i < clusterSize; i++) {
      const coinValue = COIN_VALUES[currentIdx];
      const coinY = this.getSafeY(currentX);

      // Size scales with value — enlarged for clear visibility at speed
      const sizeMap = { 100: 24, 50: 21, 25: 18, 10: 15, 5: 13 };

      this.coins.push({
        x: currentX,
        y: coinY,
        type: 'coin',
        value: coinValue,
        collected: false,
        bobPhase: Math.random() * Math.PI * 2,
        size: sizeMap[coinValue] || 10
      });

      const spacing = Phaser.Math.Between(40, 80);
      currentX += spacing;

      // Advance to next value in descending order (with randomness)
      // - 40% chance: stay at same value (repeat)
      // - 40% chance: drop by 1 tier
      // - 20% chance: skip 1-2 tiers (bigger drop)
      if (i < clusterSize - 1 && currentIdx < COIN_VALUES.length - 1) {
        const advanceRoll = Math.random();
        if (advanceRoll < 0.40) {
          // Stay at same value (repeat)
        } else if (advanceRoll < 0.80) {
          // Drop 1 tier
          currentIdx = Math.min(currentIdx + 1, COIN_VALUES.length - 1);
        } else {
          // Skip 1-2 tiers
          currentIdx = Math.min(currentIdx + Phaser.Math.Between(1, 2), COIN_VALUES.length - 1);
        }
      }
    }
  }

  spawnFuelPickup(x) {
    const terrainY = this.terrain.getHeightAt ? this.terrain.getHeightAt(x) : 400;
    let fuelY = terrainY - 30; // Fuel height fix

    // FINAL SAFETY RULE
    if (fuelY >= terrainY) fuelY = terrainY - 25;
    if (fuelY < terrainY - 60) fuelY = terrainY - 40;
    
    this.lastSpawnedFuelX = x;

    this.coins.push({
      x: x,
      y: fuelY,
      type: 'fuel',
      collected: false,
      bobPhase: Math.random() * Math.PI * 2,
      size: 14
    });
  }

  showCountdown() {
    this.isPaused = true;

    const countdownText = this.add.text(640, 360, '3', {
      fontSize: '120px',
      fontFamily: 'Outfit, Arial',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 8
    });
    countdownText.setOrigin(0.5);
    countdownText.setScrollFactor(0);
    countdownText.setDepth(100);

    let count = 3;
    this.time.addEvent({
      delay: 800,
      callback: () => {
        count--;
        if (count > 0) {
          countdownText.setText(count.toString());
          this.tweens.add({
            targets: countdownText,
            scaleX: 1.5, scaleY: 1.5,
            duration: 200, yoyo: true,
            ease: 'Back.easeOut'
          });
        } else if (count === 0) {
          countdownText.setText('GO!');
          countdownText.setColor('#00ff88');
          
          // Start engine sound immediately when race begins
          this.soundManager.startEngine();
          
          this.tweens.add({
            targets: countdownText,
            scaleX: 2, scaleY: 2, alpha: 0,
            duration: 600, ease: 'Power2',
            onComplete: () => {
              countdownText.destroy();
              this.isPaused = false;
            }
          });
        }
      },
      repeat: 3
    });
  }

  setupSocketListeners() {
    if (!this.socket) return;

    this.socket.on('gameState', (data) => {
      if (this.isGameOver) return;
      data.players.forEach(p => {
        if (p.id !== this.myId) {
          const ghost = this.ghostCars.get(p.id);
          if (ghost) ghost.updateTarget(p);
        }
      });
      EventBus.emit('leaderboardUpdate', data.leaderboard);
    });

    this.socket.on('timerUpdate', (data) => {
      EventBus.emit('timerUpdate', data);
      if (data.remaining <= 0 && !this.isGameOver) {
        this.handleGameOver('timeUp');
      }
    });

    this.socket.on('playerLeft', (data) => {
      const ghost = this.ghostCars.get(data.playerId);
      if (ghost) { ghost.destroy(); this.ghostCars.delete(data.playerId); }
    });

    this.socket.on('gameEnd', (data) => {
      this.isGameOver = true;
      EventBus.emit('gameEnd', data);
    });
  }

  handleGameOver(reason) {
    if (this.isGameOver) return;
    this.isGameOver = true;
    
    // Stop engine drone
    this.soundManager.stopEngine();

    // Dramatic Shake before snapshot
    if (reason === 'flipped' || reason === 'fell' || reason === 'fuel') {
      this.cameras.main.shake(300, 0.015);
      
      // Take snapshot instantly on the frame of impact/failure
      this.game.renderer.snapshot((image) => {
        // Emit locally for the Result Screen React state
        EventBus.emit('deathSnapshot', image.src);
      });
    }

    const distance = this.car.getDistance();
    if (this.socket) {
      this.socket.emit('playerGameOver', { reason, distance });
    } else if (this.isBotMode) {
      // Bots mode: generate rankings with bot data
      this.time.delayedCall(2500, () => {
        const rankings = this.botManager.getRankings(
          distance,
          this.players[0]?.name || 'Player',
          this.coinScore,
          false, // not finished
          0,
          true,  // gameOver
          this.players[0]?.color || '#00d4ff'
        );
        EventBus.emit('gameEnd', {
          reason: reason === 'flipped' || reason === 'fuel' || reason === 'fell' ? reason : 'gameOver',
          rankings
        });
      });
    } else {
      // Solo mode: emit game end directly after a short delay
      this.time.delayedCall(2500, () => {
        EventBus.emit('gameEnd', {
          reason: reason === 'flipped' || reason === 'fuel' || reason === 'fell' ? reason : 'gameOver',
          rankings: [{
            id: 'solo-player',
            name: this.players[0]?.name || 'Player',
            color: this.players[0]?.color || '#00d4ff',
            distance: Math.round(distance),
            rank: 1,
            coins: this.coinScore,
            finished: false,
            gameOver: true
          }]
        });
      });
    }

    let msg = '⏰ TIME UP!';
    if (reason === 'flipped') {
      msg = '🔄 FLIPPED!';
      this.soundManager.playCrashSound();
      this.car.ejectRagdoll(); // trigger ragdoll physics!
    }
    if (reason === 'fuel') msg = '⛽ OUT OF FUEL!';
    if (reason === 'fell') {
      msg = '💀 FELL OFF!';
      this.soundManager.playCrashSound();
    }

    const goText = this.add.text(640, 280, msg, {
      fontSize: '56px', fontFamily: 'Outfit, Arial',
      color: '#ff4757', stroke: '#000000', strokeThickness: 6
    });
    goText.setOrigin(0.5);
    goText.setScrollFactor(0);
    goText.setDepth(100);

    const distText = this.add.text(640, 360, `Distance: ${Math.round(distance)}m`, {
      fontSize: '28px', fontFamily: 'Outfit, Arial',
      color: '#ffffff', stroke: '#000000', strokeThickness: 4
    });
    distText.setOrigin(0.5);
    distText.setScrollFactor(0);
    distText.setDepth(100);

    this.tweens.add({
      targets: [goText, distText],
      scaleX: 1.1, scaleY: 1.1,
      duration: 400, yoyo: true, repeat: 2
    });
  }

  spawnExhaustParticle(x, y, direction) {
    const colors = [0x888888, 0x666666, 0x999999, 0xAAAAAA];
    for (let i = 0; i < 2; i++) {
      this.exhaustParticles.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 4,
        vx: -direction * (1 + Math.random() * 2),
        vy: -(0.5 + Math.random() * 1.5),
        life: 1.0,
        decay: 0.02 + Math.random() * 0.03,
        size: 3 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }

  spawnDustParticle(x, y) {
    const groundColor = Phaser.Display.Color.HexStringToColor(this.levelConfig.colors.groundTop).color;
    for (let i = 0; i < 3; i++) {
      this.exhaustParticles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y,
        vx: (Math.random() - 0.5) * 3,
        vy: -(1 + Math.random() * 2),
        life: 1.0,
        decay: 0.03 + Math.random() * 0.02,
        size: 2 + Math.random() * 5,
        color: groundColor
      });
    }
  }

  updateParticles(delta) {
    const g = this.particleGfx;
    g.clear();

    for (let i = this.exhaustParticles.length - 1; i >= 0; i--) {
      const p = this.exhaustParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.02; // slight gravity on particles
      p.life -= p.decay;
      p.size *= 0.98;

      if (p.life <= 0 || p.size < 0.5) {
        this.exhaustParticles.splice(i, 1);
        continue;
      }

      g.fillStyle(p.color, p.life * 0.6);
      g.fillCircle(p.x, p.y, p.size);
    }

    // Cap particles
    if (this.exhaustParticles.length > 100) {
      this.exhaustParticles.splice(0, this.exhaustParticles.length - 100);
    }
  }

  updateCoins(time) {
    const g = this.coinGfx;
    g.clear();

    const carPos = this.car.getPosition();
    const camLeft = this.cameras.main.scrollX - 100;
    const camRight = this.cameras.main.scrollX + 1400;

    // Generate more items ahead of the car continuously
    if (carPos.x + 2000 > Math.min(this.nextClusterX, this.nextFuelX)) {
      this.generateItems(carPos.x + 2000);
    }

    for (const coin of this.coins) {
      if (coin.collected) continue;
      if (coin.x < camLeft || coin.x > camRight) continue;

      // Bob animation
      const bobY = coin.y + Math.sin(time * 0.003 + coin.bobPhase) * 8;

      // Check collection
      const dx = carPos.x - coin.x;
      const dy = carPos.y - bobY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 75) {
        coin.collected = true;
        if (coin._label) { coin._label.destroy(); coin._label = null; }
        if (coin.type === 'fuel') {
          this.fuel = Math.min(this.maxFuel, this.fuel + 25);
          this.showPickupText(coin.x, bobY, '+25 ⛽', '#e74c3c');
          this.soundManager.playFuelSound();
        } else {
          const val = coin.value || 10;
          this.coinScore += val;
          this.showPickupText(coin.x, bobY, `+${val} 🪙`, '#ffd700');
          this.soundManager.playCoinSound();
        }
        continue;
      }

      // ── DRAW ──
      if (coin.type === 'fuel') {
        // Fuel can - RED
        g.fillStyle(0xe74c3c, 0.9);
        g.fillRoundedRect(coin.x - 7, bobY - 10, 14, 20, 3);
        g.fillStyle(0xc0392b, 1);
        g.fillRect(coin.x - 4, bobY - 14, 8, 6);
        g.fillStyle(0xFFFFFF, 0.9);
        g.fillRect(coin.x - 3, bobY - 5, 2, 10);
        g.fillRect(coin.x - 3, bobY - 5, 6, 2);
        g.fillRect(coin.x - 3, bobY, 5, 2);
        g.fillStyle(0xe74c3c, 0.15);
        g.fillCircle(coin.x, bobY, 20);
      } else {
        const sz = coin.size || 15;
        const val = coin.value || 10;

        // ── Layer 1: Pulsing outer glow (bright yellow, all coins) ──
        const glowPulse = 1.0 + Math.sin(time * 0.004 + coin.bobPhase) * 0.2;
        g.fillStyle(0xFFD700, 0.30 * glowPulse);
        g.fillCircle(coin.x, bobY, sz + 14);

        // Extra glow ring for high-value coins (100, 50)
        if (val >= 50) {
          const sparkle = 0.5 + Math.sin(time * 0.006 + coin.bobPhase) * 0.4;
          g.fillStyle(0xFFDD00, sparkle * 0.15);
          g.fillCircle(coin.x, bobY, sz + 22);
        }

        // ── Layer 2: Dark backing circle (contrast on any terrain/map) ──
        g.fillStyle(0x333300, 0.75);
        g.fillCircle(coin.x, bobY, sz + 3);

        // ── Layer 3: Main coin body — UNIFORM BRIGHT YELLOW ──
        g.fillStyle(0xFFD700, 1.0);
        g.fillCircle(coin.x, bobY, sz);

        // ── Layer 4: Animated shine sweep ──
        const shinePhase = ((time * 0.003 + coin.bobPhase) % (Math.PI * 2));
        const shineX = coin.x + Math.cos(shinePhase) * sz * 0.3;
        const shineY2 = bobY - sz * 0.15 + Math.sin(shinePhase) * sz * 0.2;
        const shineAlpha = 0.4 + Math.sin(shinePhase * 2) * 0.3;
        g.fillStyle(0xFFFFFF, shineAlpha * 0.7);
        g.fillCircle(shineX, shineY2, sz * 0.3);

        // ── Layer 5: Static highlight (upper-left, crisp) ──
        g.fillStyle(0xFFF8CC, 0.65);
        g.fillCircle(coin.x - sz * 0.22, bobY - sz * 0.22, sz * 0.35);

        // ── Layer 6: Bold dark outline (3px, sharp edges) ──
        g.lineStyle(3, 0x997700, 1.0);
        g.strokeCircle(coin.x, bobY, sz);

        // ── Layer 7: White inner ring (text area backdrop) ──
        g.fillStyle(0xFFE860, 0.5);
        g.fillCircle(coin.x, bobY, sz * 0.55);
      }
    }

    // ── Value labels: BLACK BOLD TEXT on yellow coins ──
    for (const coin of this.coins) {
      if (coin.collected || coin.type === 'fuel') continue;
      if (coin.x < camLeft || coin.x > camRight) continue;

      const val = coin.value || 10;
      const bobY = coin.y + Math.sin(time * 0.003 + coin.bobPhase) * 8;

      if (!coin._label) {
        const fontSize = val >= 100 ? '13px' : (val >= 25 ? '12px' : '11px');
        coin._label = this.add.text(coin.x, bobY, String(val), {
          fontSize: fontSize,
          fontFamily: 'Outfit, Arial',
          fontStyle: 'bold',
          color: '#000000',
          stroke: '#ffffff',
          strokeThickness: 2
        });
        coin._label.setOrigin(0.5, 0.5);
        coin._label.setDepth(7);
      }
      coin._label.setPosition(coin.x, bobY);
    }

    // Cleanup far-behind coins + their labels
    const cleanupThreshold = carPos.x - 800;
    for (const coin of this.coins) {
      if (coin.x < cleanupThreshold && coin._label) {
        coin._label.destroy();
        coin._label = null;
      }
    }
    this.coins = this.coins.filter(c => c.x > cleanupThreshold);
  }

  showPickupText(x, y, text, color) {
    const txt = this.add.text(x, y, text, {
      fontSize: '20px', fontFamily: 'Outfit, Arial',
      color: color, stroke: '#000000', strokeThickness: 3
    });
    txt.setOrigin(0.5);
    txt.setDepth(15);

    this.tweens.add({
      targets: txt,
      y: y - 50,
      alpha: 0,
      duration: 800,
      ease: 'Power2',
      onComplete: () => txt.destroy()
    });
  }

  update(time, delta) {
    if (this.isGameOver) return;

    // Always draw car and follow camera
    if (this.car) this.car.update(delta);

    if (!this.car) return; // Halt camera follow and logic if car failed

    // Camera follow (Framerate independent smooth sync)
    const carPos = this.car.getPosition();
    const targetX = carPos.x - 350;
    const targetY = carPos.y - 300;
    
    // True time-based exponential decay for jitter-free camera trailing
    const lerpFactorX = 1 - Math.pow(0.001, delta / 1000);
    const lerpFactorY = 1 - Math.pow(0.01, delta / 1000);
    
    this.cameras.main.scrollX += (targetX - this.cameras.main.scrollX) * lerpFactorX;
    this.cameras.main.scrollY += (targetY - this.cameras.main.scrollY) * lerpFactorY;
    this.cameras.main.scrollY = Math.min(this.cameras.main.scrollY, 200);

    // Update particles always
    this.updateParticles(delta);

    // Update coins always
    this.updateCoins(time);

    if (this.isPaused) return;

    // Input
    const gasPressed = this.cursors.right.isDown || this.wasd.right.isDown;
    const brakePressed = this.cursors.left.isDown || this.wasd.left.isDown;
    const tiltBackPressed = this.cursors.up.isDown || this.wasd.up.isDown;
    const tiltForwardPressed = this.cursors.down.isDown || this.wasd.down.isDown;
    const nitroPressed = Phaser.Input.Keyboard.JustDown(this.spaceKey);
    
    // Resume audio context if the browser blocked autoplay until the first keystroke
    if ((gasPressed || brakePressed || tiltBackPressed || tiltForwardPressed) && this.soundManager.context && this.soundManager.context.state === 'suspended') {
      this.soundManager.context.resume();
      if (!this.soundManager.engineStarted) this.soundManager.startEngine();
    }

    // Fuel system
    if (gasPressed && this.fuel > 0) {
      this.car.accelerate();
      const burn = this.fuelConsumptionRate * (delta / 16);
      this.fuel -= burn;

      // Exhaust particles when accelerating
      const chassisAngle = this.car.getRotation();
      const cos = Math.cos(chassisAngle);
      const sin = Math.sin(chassisAngle);
      const exhaustX = carPos.x - cos * 45;
      const exhaustY = carPos.y - sin * 45;
      this.spawnExhaustParticle(exhaustX, exhaustY, cos > 0 ? 1 : -1);

      // Dust from rear wheel
      if (Math.abs(this.car.getSpeed()) > 5) {
        const rearX = carPos.x - cos * 32 + sin * 20;
        const rearY = carPos.y - sin * 32 - cos * (-20);
        if (Math.random() < 0.4) this.spawnDustParticle(rearX, rearY);
      }
    } else {
      const idleBurn = this.fuelIdleRate * (delta / 16);
      this.fuel -= idleBurn;
    }

    // Predictive Fuel System
    const dist = Math.max(1, this.car.getDistance());
    const consumptionRate = this.totalFuelBurned / dist;
    
    // Normal predictive behavior
    if (carPos.x > this.nextFuelX) {
        this.spawnFuelPickup(this.nextFuelX);
        
        const remainingDistance = this.fuel / Math.max(0.0001, consumptionRate);
        const predictedSpawnAt = carPos.x + (remainingDistance * 0.7);
        
        // Minimum distance constraint > 300m (random 300m to 600m)
        const minSpawnDist = Phaser.Math.Between(3000, 6000);
        this.nextFuelX = Math.max(predictedSpawnAt, carPos.x + minSpawnDist);
    }

    // SMART SPAWN (IMPORTANT): Fuel < 30%
    if (this.fuel < 30 && carPos.x > this.lastSpawnedFuelX + 250) {
      const fuelX = carPos.x + 300;
      this.spawnFuelPickup(fuelX);
      // Push back standard spawn
      this.nextFuelX = fuelX + Phaser.Math.Between(3000, 6000); 
    }

    if (brakePressed) this.car.brake();
    if (tiltBackPressed) this.car.tiltBack();
    if (tiltForwardPressed) this.car.tiltForward();

    // Nitro activation (SPACE — one press only, not continuous)
    if (nitroPressed && this.car.nitro && this.car.nitro.canActivate()) {
      const fuelCost = NITRO_CONFIG.fuelCost || 8;
      if (this.fuel >= fuelCost) {
        const activated = this.car.activateNitro();
        if (activated) {
          this.fuel -= fuelCost;
          this.showPickupText(
            this.car.getPosition().x,
            this.car.getPosition().y - 60,
            '🔥 NITRO!',
            '#00ffff'
          );
          this.cameras.main.shake(150, 0.005); // Subtle screen shake
        }
      }
    }

    // Draw nitro flame effects
    if (this.car.nitro) {
      this.nitroGfx.clear();
      this.car.nitro.drawParticles(this.nitroGfx);

      // Chassis glow during nitro
      if (this.car.nitro.isActive) {
        const pos = this.car.getPosition();
        const glowAlpha = 0.15 * this.car.nitro.intensity;
        this.nitroGfx.fillStyle(0x00FFFF, glowAlpha);
        this.nitroGfx.fillCircle(pos.x, pos.y, 70);
        this.nitroGfx.fillStyle(0x4488FF, glowAlpha * 0.5);
        this.nitroGfx.fillCircle(pos.x, pos.y, 100);
      }
    }

    // Fuel empty check
    this.fuel = Math.max(0, this.fuel);
    if (this.fuel <= 0) {
      this.handleGameOver('fuel');
      return;
    }

    // Check flip
    if (this.car.checkFlip(delta)) {
      this.handleGameOver('flipped');
      return;
    }

    // Check fall (rooftop gaps etc.)
    const carY = this.car.getPosition().y;
    if (carY > 700) {
      this.handleGameOver('fell');
      return;
    }

    // Generate terrain ahead
    this.terrain.update(this.cameras.main.scrollX);

    // Collision filter for new terrain
    this.matter.world.getAllBodies().forEach(body => {
      if (body.label === 'terrain' && body.collisionFilter.category !== this.terrainCategory) {
        body.collisionFilter.category = this.terrainCategory;
        body.collisionFilter.mask = this.carCategory;
      }
    });

    // Ghost cars (multiplayer)
    this.ghostCars.forEach(ghost => ghost.update());

    // Bot Manager update + HUD emissions
    if (this.botManager) {
      const playerDist = this.car.getDistance();
      const targetDist = this.levelConfig.targetDistance;
      this.botManager.update(delta, playerDist, targetDist);

      // Emit position and leaderboard for HUD
      if (this.hudUpdateTimer === 0) {
        const pos = this.botManager.getPlayerPosition(Math.round(playerDist));
        EventBus.emit('positionUpdate', pos);
        const lb = this.botManager.getLeaderboard(
          Math.round(playerDist),
          this.players[0]?.name || 'Player'
        );
        EventBus.emit('botLeaderboardUpdate', lb);
      }
    }

    // Position updates
    this.updateCounter += delta;
    if (this.updateCounter >= 50 && this.socket) {
      this.updateCounter = 0;
      const pos = this.car.getPosition();
      const vel = this.car.getVelocity();
      this.socket.emit('playerUpdate', {
        x: pos.x, y: pos.y,
        rotation: this.car.getRotation(),
        velocityX: vel.x, velocityY: vel.y,
        distance: this.car.getDistance()
      });
    }

    // HUD updates
    this.hudUpdateTimer += delta;
    if (this.hudUpdateTimer >= 100) {
      this.hudUpdateTimer = 0;
      EventBus.emit('hudUpdate', {
        distance: Math.round(this.car.getDistance()),
        speed: Math.round(this.car.getSpeed()),
        fuel: Math.round(this.fuel),
        coins: this.coinScore,
        nitro: this.car.getNitroHudData ? this.car.getNitroHudData() : null
      });
    }

    // Distance markers
    this.drawDistanceMarkers();

    // Target distance check
    const targetDist = this.levelConfig.targetDistance;
    if (this.car.getDistance() >= targetDist) {
      this.isGameOver = true;
      this.soundManager.stopEngine();
      this.soundManager.playFinishSound();
      
      const finishTime = (Date.now() - this.game.registry.get('startTime')) / 1000;
      if (this.socket) {
        this.socket.emit('playerFinished', {
          distance: this.car.getDistance(),
          time: finishTime
        });
      } else if (this.isBotMode) {
        // Bots mode: generate rankings with bot data
        this.time.delayedCall(2500, () => {
          const rankings = this.botManager.getRankings(
            Math.round(this.car.getDistance()),
            this.players[0]?.name || 'Player',
            this.coinScore,
            true,  // finished
            Math.round(finishTime),
            false, // not gameOver
            this.players[0]?.color || '#00d4ff'
          );
          EventBus.emit('gameEnd', {
            reason: 'finished',
            rankings
          });
        });
      } else {
        // Solo mode: emit finish via EventBus
        this.time.delayedCall(2500, () => {
          EventBus.emit('gameEnd', {
            reason: 'finished',
            rankings: [{
              id: 'solo-player',
              name: this.players[0]?.name || 'Player',
              color: this.players[0]?.color || '#00d4ff',
              distance: Math.round(this.car.getDistance()),
              rank: 1,
              coins: this.coinScore,
              finished: true,
              finishTime: Math.round(finishTime),
              gameOver: false
            }]
          });
        });
      }

      const winText = this.add.text(640, 280, '🏁 FINISH!', {
        fontSize: '72px', fontFamily: 'Outfit, Arial',
        color: '#2ed573', stroke: '#000000', strokeThickness: 6
      });
      winText.setOrigin(0.5);
      winText.setScrollFactor(0);
      winText.setDepth(100);

      const distText = this.add.text(640, 370, `${Math.round(this.car.getDistance())}m • ${this.coinScore} coins`, {
        fontSize: '24px', fontFamily: 'Outfit, Arial',
        color: '#ffffff', stroke: '#000000', strokeThickness: 4
      });
      distText.setOrigin(0.5);
      distText.setScrollFactor(0);
      distText.setDepth(100);
    }
    
    // Update engine sound — use throttle state for more accurate RPM
    this.soundManager.updateEngine(this.car.getSpeed(), this.car.getThrottle() > 0.1);
  }

  drawDistanceMarkers() {
    const startX = this.car.startX;
    const meterPerPixel = 10;
    const markerEvery = 500 * meterPerPixel;

    const camLeft = this.cameras.main.scrollX;
    const camRight = camLeft + 1280;

    const firstMarker = Math.max(1, Math.floor((camLeft - startX) / markerEvery));
    const lastMarker = Math.ceil((camRight - startX) / markerEvery);

    for (let i = firstMarker; i <= lastMarker; i++) {
      const mx = startX + i * markerEvery;
      if (mx > this.lastMarkerX) {
        const dist = i * 500;
        this.distanceMarkers.lineStyle(2, 0xFFFFFF, 0.3);
        this.distanceMarkers.lineBetween(mx, 0, mx, 800);

        const label = this.add.text(mx, 100, `${dist}m`, {
          fontSize: '14px', fontFamily: 'Outfit, Arial',
          color: '#ffffff', stroke: '#000000', strokeThickness: 3
        });
        label.setOrigin(0.5);
        label.setDepth(4);
        label.setAlpha(0.5);
        this.lastMarkerX = mx;
      }
    }
  }

  pauseGame() {
    if (this.isGameOver || this.isPausedByUser) return;
    this.isPausedByUser = true;
    this.isPaused = true;
    // Freeze physics
    this.matter.world.pause();
    // Play pause sound before suspending audio
    this.soundManager.playPauseSound();
    // Slight delay so the pause sound plays before we freeze audio
    setTimeout(() => {
      this.soundManager.pauseAllSounds();
    }, 250);
  }

  resumeGame() {
    if (!this.isPausedByUser) return;
    // Resume audio first so the resume sound can play
    this.soundManager.resumeAllSounds();
    this.soundManager.playResumeSound();
    this.isPausedByUser = false;
    this.isPaused = false;
    // Resume physics
    this.matter.world.resume();
  }

  shutdown() {
    // Clean up pause/resume listeners
    if (this._onPauseGame) EventBus.off('pauseGame', this._onPauseGame);
    if (this._onResumeGame) EventBus.off('resumeGame', this._onResumeGame);
    if (this.car) this.car.destroy();
    this.ghostCars.forEach(g => g.destroy());
    this.ghostCars.clear();
    if (this.botManager) { this.botManager.destroy(); this.botManager = null; }
    if (this.terrain) this.terrain.destroy();
    if (this.socket) {
      this.socket.off('gameState');
      this.socket.off('timerUpdate');
      this.socket.off('playerLeft');
      this.socket.off('gameEnd');
    }
  }
}
