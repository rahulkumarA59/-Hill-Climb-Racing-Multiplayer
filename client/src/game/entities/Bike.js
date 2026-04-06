import Phaser from 'phaser';
import { BIKE_PHYSICS } from '../PhysicsConfig.js';
import NitroSystem from './NitroSystem.js';

export default class Bike {
  constructor(scene, x, y, color = '#ff4757', physicsOverrides = {}) {
    this.scene = scene;
    this.color = color;
    this.startX = x;

    this.config = { ...BIKE_PHYSICS, ...physicsOverrides };

    this.flipTimer = 0;
    this.isFlipped = false;
    this.isDestroyed = false;
    this.isRagdolling = false;
    this.maxDistance = 0;

    this.previousIsGrounded = true;
    this.landingDampingFrames = 0;
    
    // Wheelie Tracking
    this.wheelieTimer = 0;
    this.lastAngle = 0;
    this.accumulatedAngle = 0;
    this.pendingFlips = 0;

    this.throttle = 0;
    this.inputGas = false;
    this.inputBrake = false;
    this.inputTilt = 0;
    this.isBraking = false;
    this.isReversing = false;

    // Nitro Boost System
    this.nitro = new NitroSystem(scene);

    try {
      this.createBike(x, y);
      this.createVisuals();
    } catch (e) {
      console.error("BIKE INITIALIZATION ERROR:", e);
    }
  }

  createBike(x, y) {
    const cfg = this.config;
    const Body = Phaser.Physics.Matter.Matter.Body;
    const chassisCenterY = y - 20;

    // Main Rigid Body (Chassis) - Box shape aligned perfectly in center
    this.chassis = this.scene.matter.add.rectangle(
      x, chassisCenterY,
      cfg.chassisWidth, cfg.chassisHeight,
      {
        density: cfg.chassisDensity,
        friction: cfg.chassisFriction,
        frictionAir: cfg.chassisFrictionAir,
        restitution: cfg.chassisRestitution,
        label: 'chassis',
        chamfer: { radius: cfg.chassisChamfer },
        collisionFilter: {
          category: 0x0002,
          mask: 0x0001,
          group: -1
        }
      }
    );

    const wheelOpts = {
      density: cfg.wheelDensity,
      friction: cfg.wheelFriction,
      frictionAir: 0.001,
      restitution: cfg.wheelRestitution,
      label: 'wheel',
      collisionFilter: {
        category: 0x0002,
        mask: 0x0001,
        group: -1
      }
    };

    // RIGID PIN JOINTS — Same proven approach as Car.js
    // Length 1 + Stiffness 1 = wheels pinned to chassis, only rotation allowed.
    // This transfers 100% of engine force to the ground (no spring absorption).
    const hingeOpts = {
      length: 1,         // Near-zero vertical give
      stiffness: 1,      // Rigid — no energy loss
      damping: 0.15,     // Slight damping for landing comfort
    };

    const effectiveOffsetY = cfg.chassisHeight / 2 + 2; // Wheels sit just below chassis

    this.rearWheel = this.scene.matter.add.circle(
      x - cfg.wheelOffsetX, chassisCenterY + effectiveOffsetY, cfg.wheelRadius, wheelOpts
    );
    this.frontWheel = this.scene.matter.add.circle(
      x + cfg.wheelOffsetX, chassisCenterY + effectiveOffsetY, cfg.wheelRadius, wheelOpts
    );

    this.rearSpring = this.scene.matter.add.constraint(
      this.chassis, this.rearWheel,
      hingeOpts.length, hingeOpts.stiffness,
      {
        ...hingeOpts,
        pointA: { x: -cfg.wheelOffsetX, y: effectiveOffsetY },
        pointB: { x: 0, y: 0 },
        label: 'rearHinge'
      }
    );
    this.frontSpring = this.scene.matter.add.constraint(
      this.chassis, this.frontWheel,
      hingeOpts.length, hingeOpts.stiffness,
      {
        ...hingeOpts,
        pointA: { x: cfg.wheelOffsetX, y: effectiveOffsetY },
        pointB: { x: 0, y: 0 },
        label: 'frontHinge'
      }
    );
    // NOTE: Guide constraints REMOVED — they were absorbing engine force
  }

  createVisuals() {
    this.chassisGfx = this.scene.add.graphics();
    this.chassisGfx.setDepth(10);
    this.wheelGfx = this.scene.add.graphics();
    this.wheelGfx.setDepth(9);
  }

  accelerate() {
    if (this.isDestroyed || this.isFlipped) return;
    this.inputGas = true;
  }

  brake() {
    if (this.isDestroyed || this.isFlipped) return;
    this.inputBrake = true;
  }

  tiltBack(strength = 1.0) {
    if (this.isDestroyed) return;
    this.inputTilt = -strength;
  }

  tiltForward(strength = 1.0) {
    if (this.isDestroyed) return;
    this.inputTilt = strength;
  }

  ejectRagdoll() {
    if (this.isDestroyed || this.isRagdolling) return;
    this.isRagdolling = true;

    const chassisAngle = this.chassis.angle;
    const cos = Math.cos(chassisAngle);
    const sin = Math.sin(chassisAngle);

    // Eject rider cleanly
    this.ragdollPos = {
      x: this.chassis.position.x + cos * -2 - sin * -25,
      y: this.chassis.position.y + sin * -2 + cos * -25
    };
    this.ragdollVelocity = {
      x: this.chassis.velocity.x * 1.2,
      y: this.chassis.velocity.y - 10
    };
    this.ragdollAngle = chassisAngle;
  }

  applyPhysics(delta) {
    const Body = Phaser.Physics.Matter.Matter.Body;
    const cfg = this.config;
    const chassis = this.chassis;
    const deltaScale = delta / 16.666;

    const angle = chassis.angle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const forwardSpeed = chassis.velocity.x * cosA + chassis.velocity.y * sinA;
    const absSpeed = Math.abs(forwardSpeed);

    const isGrounded = this.isGrounded();
    
    // ============================================
    // Wheelie & Flips Detection System (Strict)
    // ============================================
    if (isGrounded) {
       this.accumulatedAngle = 0;
       this.pendingFlips = 0;
       
       // Detect Wheelie (Rear wheel touching, Front wheel high in air)
       // A wheelie is valid if tilt is between 0.4 and 1.2 radians, and speed > 1
       if (angle > 0.4 && angle < 1.4 && absSpeed > 1) {
          this.wheelieTimer += delta;
          if (this.wheelieTimer >= 1000) { // Check every 1 second interval of continuous wheelie
             this.wheelieTimer -= 1000;
             // Grant 250 coins after prolonged wheelie
             this.scene.events.emit('coinSpawned', { x: chassis.position.x, y: chassis.position.y - 40, value: 250 });
          }
       } else {
          this.wheelieTimer = 0; // Reset if wheelie drops
       }

       chassis.frictionAir = cfg.chassisFrictionAir;
       this.lastAngle = angle;
       
    } else {
       this.wheelieTimer = 0; // Lost ground contact
       
       const deltaAngle = Phaser.Math.Angle.Wrap(angle - this.lastAngle);
       this.accumulatedAngle += deltaAngle;
       this.lastAngle = angle;
       
       // Flip logic
       const newFlips = Math.floor(Math.abs(this.accumulatedAngle) / (Math.PI * 2));
       if (newFlips > this.pendingFlips) {
           this.pendingFlips = newFlips;
           const rewardCoins = 1500;
           this.scene.events.emit('airFlipCompleted', {
               flips: 1, x: chassis.position.x, y: chassis.position.y - 60, reward: rewardCoins, isBike: true
           });
       }

       if (this.inputTilt === 0) Body.setAngularVelocity(chassis, chassis.angularVelocity * Math.pow(0.96, deltaScale));
       chassis.frictionAir = 0.0005;
       
       // Air wheel sync
       const expectedAngVel = forwardSpeed / cfg.wheelRadius;
       Body.setAngularVelocity(this.rearWheel, expectedAngVel);
       Body.setAngularVelocity(this.frontWheel, expectedAngVel);
    }
    this.previousIsGrounded = isGrounded;

    // ============================================
    // Throttle & Braking (INPUT SMOOTHING via lerp)
    // ============================================
    if (this.inputGas) {
      this.isBraking = false;
      this.isReversing = false;
      // Smooth lerp ramp-up instead of instant addition
      const targetThrottle = 1.0;
      this.throttle = Phaser.Math.Linear(this.throttle, targetThrottle, cfg.throttleRampUp * deltaScale);
    } else if (this.inputBrake) {
      if (forwardSpeed > 0.5) {
        this.isBraking = true;
        this.throttle = Phaser.Math.Linear(this.throttle, 0, cfg.throttleRampDown * 2 * deltaScale);
      } else {
        this.isBraking = false;
        this.isReversing = true;
        this.throttle = Phaser.Math.Linear(this.throttle, -0.6, cfg.throttleRampUp * 0.5 * deltaScale);
      }
    } else {
      this.throttle *= Math.pow(cfg.engineBraking, deltaScale);
      if (Math.abs(this.throttle) < 0.01) this.throttle = 0;
    }

    // ============================================
    // SLOPE DETECTION
    // ============================================
    // Negative angle = going uphill (nose pointing up), Positive = downhill
    const slopeAngle = angle; // chassis angle == slope when grounded
    const isUphill = isGrounded && slopeAngle < -0.05;
    const isDownhill = isGrounded && slopeAngle > 0.05;
    const slopeSeverity = Phaser.Math.Clamp(Math.abs(slopeAngle) / 0.8, 0, 1); // 0→1

    // ============================================
    // ANTI-WHEELIE (Only on flat / mild slopes)
    // ============================================
    let antiWheelieMultiplier = 1.0;
    if (isGrounded && !isUphill && angle < -0.2) {
      // On FLAT ground, tilting backward = wheelie risk
      const tiltSeverity = Phaser.Math.Clamp(Math.abs(angle) / 0.6, 0, 1);
      antiWheelieMultiplier = 1.0 - tiltSeverity * 0.8;
      
      const correctionForce = tiltSeverity * 0.0006 * (chassis.mass || 7) * deltaScale;
      Body.applyForce(chassis, 
        { x: chassis.position.x + cosA * cfg.wheelOffsetX, y: chassis.position.y },
        { x: 0, y: correctionForce }
      );
    }

    // ============================================
    // DYNAMIC WHEEL FRICTION (Slope-Aware)
    // ============================================
    if (isGrounded) {
      // Base friction
      let rearFriction = cfg.wheelFriction;
      let frontFriction = cfg.wheelFriction * 0.8;
      
      if (isUphill) {
        // BOOST rear grip on slopes — prevent tire spin
        rearFriction += slopeSeverity * 0.6; // Up to +0.6 extra grip
        frontFriction += slopeSeverity * 0.2;
      }
      
      this.rearWheel.friction = rearFriction;
      this.frontWheel.friction = frontFriction;
    }

    // ============================================
    // GRAVITY COMPENSATION (Uphill Push)
    // ============================================
    if (isUphill && this.inputGas) {
      // Apply a forward force along the slope to compensate for gravity pulling bike back
      const gravityCompensation = slopeSeverity * 0.0012 * (chassis.mass || 7) * deltaScale;
      Body.applyForce(chassis, chassis.position, {
        x: cosA * gravityCompensation,
        y: sinA * gravityCompensation
      });
    }

    // ============================================
    // Apply Engine Forces (SLOPE-ADAPTIVE + NITRO)
    // ============================================
    // Nitro multipliers
    const nitroForceMultiplier = this.nitro.getForceMultiplier();
    const nitroSpeedMultiplier = this.nitro.getSpeedCapMultiplier();

    // Force direction uses cosA/sinA = already aligned to chassis/slope angle ✔
    if (this.throttle !== 0 && isGrounded) {
      const baseMaxSpeed = this.throttle > 0 ? cfg.maxSpeed : cfg.maxReverseSpeed;
      const currentMaxSpeed = baseMaxSpeed * nitroSpeedMultiplier;
      let governor = 1.0;
      const speedRatio = absSpeed / currentMaxSpeed;
      if (speedRatio > 0.7) {
        governor = 1.0 / (1.0 + Math.pow((speedRatio - 0.7) / 0.3 * 2, cfg.governorSharpness));
      }

      // LOW-SPEED TORQUE MULTIPLIER — strong at low speed (for climbing), tapers at high speed
      const lowSpeedBoost = 1.0 + Phaser.Math.Clamp(1.0 - absSpeed / 3.0, 0, 1) * 0.8; // Up to 1.8x at standstill

      // SLOPE TORQUE MULTIPLIER — extra power going uphill
      let slopeTorqueBoost = 1.0;
      if (isUphill && this.throttle > 0) {
        slopeTorqueBoost = 1.0 + slopeSeverity * 1.5; // Up to 2.5x on steep slopes
      }

      const thrustDir = this.throttle > 0 ? 1 : -1;
      const forceMult = this.throttle > 0 ? cfg.accelerationForce : cfg.reverseForce;
      const smoothThrottle = Phaser.Math.Easing.Sine.Out(Math.abs(this.throttle));
      const thrustMagnitude = (chassis.mass || 7) * forceMult * smoothThrottle * governor * antiWheelieMultiplier * lowSpeedBoost * slopeTorqueBoost * nitroForceMultiplier;
      
      Body.applyForce(chassis, chassis.position, { x: cosA * thrustMagnitude * thrustDir, y: sinA * thrustMagnitude * thrustDir });

      // Wheel spin (slope-boosted rear wheel torque)
      const wheelSpin = cfg.wheelDriveForce * thrustDir * governor * antiWheelieMultiplier * slopeTorqueBoost * nitroForceMultiplier;
      Body.setAngularVelocity(this.rearWheel, Phaser.Math.Clamp(this.rearWheel.angularVelocity + wheelSpin * deltaScale, -cfg.maxWheelAngVel * nitroSpeedMultiplier, cfg.maxWheelAngVel * nitroSpeedMultiplier));
      Body.setAngularVelocity(this.frontWheel, Phaser.Math.Clamp(this.frontWheel.angularVelocity + wheelSpin * cfg.frontWheelDriveRatio * deltaScale, -cfg.maxWheelAngVel * nitroSpeedMultiplier, cfg.maxWheelAngVel * nitroSpeedMultiplier));
    }

    // ANTI-STALL: If on a slope, moving very slowly, and holding gas — apply minimum push
    if (isUphill && this.inputGas && absSpeed < 0.5 && isGrounded) {
      const stallPush = 0.0004 * (chassis.mass || 7) * deltaScale;
      Body.applyForce(chassis, chassis.position, { x: cosA * stallPush, y: sinA * stallPush });
    }

    if (this.isBraking && isGrounded && absSpeed > 0.3) {
      const brakeMag = (chassis.mass || 7) * cfg.brakeForce;
      const brakeDir = forwardSpeed > 0 ? -1 : 1;
      Body.applyForce(chassis, chassis.position, { x: cosA * brakeMag * brakeDir, y: sinA * brakeMag * brakeDir });
      
      // Gentle stoppie effect (reduced from 0.003 to 0.001)
      Body.setAngularVelocity(chassis, chassis.angularVelocity + 0.001 * deltaScale);
      Body.setAngularVelocity(this.rearWheel, this.rearWheel.angularVelocity * Math.pow(0.9, deltaScale));
      Body.setAngularVelocity(this.frontWheel, this.frontWheel.angularVelocity * Math.pow(0.9, deltaScale));
    }

    // Dynamic Tilt Controls
    if (this.inputTilt !== 0) {
      if (isGrounded) {
        const leanTorque = this.inputTilt * cfg.groundTiltMultiplier * 0.008 * deltaScale;
        Body.setAngularVelocity(chassis, chassis.angularVelocity + leanTorque);
      } else {
        const tiltForce = this.inputTilt * cfg.airTiltTorque * deltaScale;
        Body.setAngularVelocity(chassis, Phaser.Math.Clamp(chassis.angularVelocity + tiltForce, -cfg.maxAngularVelocity, cfg.maxAngularVelocity));
      }
    }

    // ============================================
    // ANGULAR DAMPING (Every frame on ground)
    // ============================================
    if (isGrounded) {
      // Always apply angular damping when grounded — prevents spinning
      Body.setAngularVelocity(chassis, chassis.angularVelocity * Math.pow(cfg.groundAngularDamping, deltaScale));
      
      // Stronger auto-stabilization across wider angle range
      if (Math.abs(angle) > 0.1 && this.inputTilt === 0) {
        const correctionStrength = cfg.groundStabilization * Math.abs(angle) * deltaScale;
        const correction = angle > 0 ? -correctionStrength : correctionStrength;
        Body.setAngularVelocity(chassis, chassis.angularVelocity + correction);
      }
    }

    // Nitro Stabilization: dampen angular velocity during active nitro
    if (this.nitro.isActive && isGrounded) {
      const stabFactor = this.nitro.getStabilizationFactor();
      Body.setAngularVelocity(chassis, chassis.angularVelocity * Math.pow(stabFactor, deltaScale));
    }
  }

  isGrounded() {
    const pairs = this.scene.matter.world.engine.pairs.list;
    const rearId = this.rearWheel.id;
    const frontId = this.frontWheel.id;

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (!pair.isActive) continue;
      
      const aLabel = pair.bodyA.label;
      const bLabel = pair.bodyB.label;
      const aId = pair.bodyA.id;
      const bId = pair.bodyB.id;

      if ((aId === rearId || aId === frontId) && bLabel === 'terrain') return true;
      if ((bId === rearId || bId === frontId) && aLabel === 'terrain') return true;
    }
    return false;
  }

  getPosition() { return this.isDestroyed ? { x: 0, y: 0 } : { x: this.chassis.position.x, y: this.chassis.position.y }; }
  getRotation() { return this.isDestroyed ? 0 : this.chassis.angle; }
  getVelocity() { return this.isDestroyed ? { x: 0, y: 0 } : { x: this.chassis.velocity.x, y: this.chassis.velocity.y }; }
  
  getDistance() {
    if (this.isDestroyed) return this.maxDistance;
    const dist = Math.max(0, (this.chassis.position.x - this.startX) / this.config.distanceScale);
    this.maxDistance = Math.max(this.maxDistance, dist);
    return this.maxDistance;
  }
  
  getSpeed() {
    if (this.isDestroyed) return 0;
    const vx = this.chassis.velocity.x;
    const vy = this.chassis.velocity.y;
    return Math.sqrt(vx * vx + vy * vy) * this.config.speedDisplayScale;
  }
  getThrottle() { return this.throttle; }

  checkFlip(delta) {
    if (this.isDestroyed) return false;
    let angle = this.chassis.angle % (Math.PI * 2);
    if (angle < 0) angle += Math.PI * 2;
    const isUpsideDown = (angle > this.config.flipAngleMin && angle < this.config.flipAngleMax) ||
                         (angle > (Math.PI * 2 - this.config.flipAngleMax) && angle < (Math.PI * 2 - this.config.flipAngleMin));

    if (isUpsideDown) {
      this.flipTimer += delta;
      if (this.flipTimer > this.config.flipTimeout) {
        this.isFlipped = true;
        return true;
      }
    } else {
      this.flipTimer = Math.max(0, this.flipTimer - delta * 2);
    }
    return false;
  }

  drawBike() {
    try {
      if (this.isDestroyed) return;
      const cfg = this.config;
      const cg = this.chassisGfx;
      const wg = this.wheelGfx;
      cg.clear();
      wg.clear();

      const chassisX = this.chassis.position.x;
      const chassisY = this.chassis.position.y;
      const angle = this.chassis.angle;
      const colorNum = Phaser.Display.Color.HexStringToColor(this.color).color;

      // Use Phaser's setPosition + setRotation (proven working from Car.js)
      cg.setPosition(chassisX, chassisY);
      cg.setRotation(angle);

      // All coordinates below are LOCAL to the chassis center

      // Calculate wheel positions in chassis-local space for fork/swingarm drawing
      const cosA = Math.cos(-angle);
      const sinA = Math.sin(-angle);
      const dxF = this.frontWheel.position.x - chassisX;
      const dyF = this.frontWheel.position.y - chassisY;
      const localFrontX = dxF * cosA - dyF * sinA;
      const localFrontY = dxF * sinA + dyF * cosA;
      const dxR = this.rearWheel.position.x - chassisX;
      const dyR = this.rearWheel.position.y - chassisY;
      const localRearX = dxR * cosA - dyR * sinA;
      const localRearY = dxR * sinA + dyR * cosA;

      // ── 1. Front Forks (Telescopic) ──
      // Upper tube (chrome)
      cg.lineStyle(5, 0xaaaaaa, 1);
      cg.beginPath();
      cg.moveTo(18, -6);
      cg.lineTo(localFrontX, localFrontY);
      cg.strokePath();
      // Lower tube (dark slider)
      cg.lineStyle(7, 0x333333, 1);
      const forkMidX = localFrontX + (18 - localFrontX) * 0.4;
      const forkMidY = localFrontY + (-6 - localFrontY) * 0.4;
      cg.beginPath();
      cg.moveTo(localFrontX, localFrontY);
      cg.lineTo(forkMidX, forkMidY);
      cg.strokePath();

      // ── 2. Rear Swingarm ──
      cg.lineStyle(6, 0x888888, 1);
      cg.beginPath();
      cg.moveTo(-5, 6);
      cg.lineTo(localRearX, localRearY);
      cg.strokePath();
      // Shock absorber spring
      cg.lineStyle(3, colorNum, 1);
      cg.beginPath();
      cg.moveTo(-10, -4);
      cg.lineTo(localRearX + 8, localRearY - 6);
      cg.strokePath();

      // ── 3. Engine Block ──
      cg.fillStyle(0x222222, 1);
      cg.fillRoundedRect(-12, -2, 22, 14, 3);
      cg.fillStyle(0x444444, 1);
      cg.fillRoundedRect(-8, -10, 14, 10, 2);

      // Exhaust pipe
      cg.lineStyle(4, 0x777777, 1);
      cg.beginPath();
      cg.moveTo(6, 5);
      cg.lineTo(-5, 10);
      cg.lineTo(-25, 5);
      cg.strokePath();
      cg.fillStyle(0x111111, 1);
      cg.fillCircle(-25, 5, 3);

      // ── 4. Gas Tank (Team Color) ──
      cg.fillStyle(colorNum, 1);
      cg.beginPath();
      cg.moveTo(5, -14);
      cg.lineTo(22, -12);
      cg.lineTo(26, -2);
      cg.lineTo(2, -2);
      cg.closePath();
      cg.fill();

      // Tail Fairing (Team Color)
      cg.beginPath();
      cg.moveTo(2, -8);
      cg.lineTo(-24, -16);
      cg.lineTo(-28, -10);
      cg.lineTo(-5, -2);
      cg.closePath();
      cg.fill();

      // ── 5. Seat ──
      cg.fillStyle(0x111111, 1);
      cg.beginPath();
      cg.moveTo(-4, -10);
      cg.lineTo(-20, -16);
      cg.lineTo(-18, -19);
      cg.lineTo(0, -12);
      cg.closePath();
      cg.fill();

      // ── 6. Handlebars ──
      cg.lineStyle(4, 0x111111, 1);
      cg.beginPath();
      cg.moveTo(18, -6);
      cg.lineTo(12, -20);
      cg.strokePath();

      // Headlight
      cg.fillStyle(0xFFFF00, 0.9);
      cg.fillCircle(26, -6, 4);

      // ── 7. Rider (No nested transforms — all math-based) ──
      if (!this.isRagdolling) {
        // Lean factor based on input
        let lean = 0;
        if (this.inputGas) lean = 3;
        if (this.isBraking || this.throttle < -0.1) lean = -2;
        if (this.inputTilt > 0) lean = 5;
        if (this.inputTilt < 0) lean = -3;

        const seatX = -10;
        const seatY = -17;

        // Torso (team color racing suit)
        cg.fillStyle(colorNum, 0.9);
        cg.fillRoundedRect(seatX - 5 + lean * 0.3, seatY - 18, 10, 20, 4);

        // Helmet
        cg.fillStyle(0xCCCCCC, 1);
        cg.fillCircle(seatX + 2 + lean * 0.4, seatY - 22, 8);
        // Visor
        cg.fillStyle(0x111111, 1);
        cg.fillRect(seatX + 2 + lean * 0.4, seatY - 25, 6, 6);

        // Arms (from shoulder to handlebars)
        const shoulderX = seatX + lean * 0.3;
        const shoulderY = seatY - 14;
        const handTargetX = 12;
        const handTargetY = -20;
        const elbowX = (shoulderX + handTargetX) / 2 + 4;
        const elbowY = (shoulderY + handTargetY) / 2 - 3;

        cg.lineStyle(5, colorNum, 1);
        cg.beginPath();
        cg.moveTo(shoulderX, shoulderY);
        cg.lineTo(elbowX, elbowY);
        cg.lineTo(handTargetX, handTargetY);
        cg.strokePath();

        // Gloves
        cg.fillStyle(0x222222, 1);
        cg.fillCircle(handTargetX, handTargetY, 3);

        // Legs (hip to knee to footpeg)
        cg.lineStyle(6, 0x222222, 1);
        cg.beginPath();
        cg.moveTo(seatX - 2, seatY + 2);
        cg.lineTo(seatX + 8 + lean * 0.2, seatY + 12);
        cg.lineTo(0, 8);
        cg.strokePath();

        // Boot
        cg.fillStyle(0x111111, 1);
        cg.fillCircle(0, 8, 3);
      }

      // ── 8. Ragdoll Rider (world-space, drawn on wheel layer) ──
      if (this.isRagdolling) {
        wg.fillStyle(colorNum, 0.9);
        wg.fillRoundedRect(this.ragdollPos.x - 5, this.ragdollPos.y - 10, 10, 20, 4);
        wg.fillStyle(0xCCCCCC, 1);
        wg.fillCircle(this.ragdollPos.x, this.ragdollPos.y - 15, 8);
        wg.fillStyle(0x111111, 1);
        wg.fillRect(this.ragdollPos.x, this.ragdollPos.y - 18, 6, 6);
      }

      // ── 9. Wheels (world-space) ──
      this.drawWheel(wg, this.frontWheel.position.x, this.frontWheel.position.y, cfg.wheelRadius, this.frontWheel.angle);
      this.drawWheel(wg, this.rearWheel.position.x, this.rearWheel.position.y, cfg.wheelRadius, this.rearWheel.angle);

    } catch (e) {
      console.error("DRAW BIKE ERROR:", e);
    }
  }

  drawWheel(g, x, y, radius, angle) {
    g.fillStyle(0x222222, 1);
    g.fillCircle(x, y, radius);

    // Spokes
    g.lineStyle(2, 0x000000, 1);
    for (let i = 0; i < 6; i++) {
        const a = angle + (i * Math.PI / 3);
        const ex = x + Math.cos(a) * radius;
        const ey = y + Math.sin(a) * radius;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(ex, ey);
        g.strokePath();
    }

    g.fillStyle(0xDDDDDD, 1);
    g.fillCircle(x, y, radius * 0.6);
    g.fillStyle(0x222222, 1);
    g.fillCircle(x, y, radius * 0.5);
    g.fillStyle(0x666666, 1);
    g.fillCircle(x, y, radius * 0.15);
  }

  // ─── NITRO ────────────────────────────────────────────────────────────

  activateNitro() {
    if (this.isDestroyed || this.isFlipped || this.isRagdolling) return false;
    return this.nitro.activate();
  }

  getNitroHudData() {
    return this.nitro.getHudData();
  }

  update(delta) {
    try {
      if (this.isDestroyed) return;

      // Update nitro system every frame
      this.nitro.update(delta);

      if (this.isRagdolling) {
        this.ragdollPos.x += this.ragdollVelocity.x;
        this.ragdollPos.y += this.ragdollVelocity.y;
        this.ragdollVelocity.y += 0.5; // Gravity on ragdoll
        this.ragdollAngle += 0.15;
      } else {
        this.applyPhysics(delta);

        // Nitro flame particles
        if (this.nitro.isActive) {
          this.nitro.spawnNitroFlame(
            this.chassis.position.x,
            this.chassis.position.y,
            this.chassis.angle
          );
        }
      }

      this.drawBike();

      this.inputGas = false;
      this.inputBrake = false;
      this.inputTilt = 0;
    } catch (e) {
      console.error("BIKE UPDATE ERROR:", e);
    }
  }

  destroy() {
    this.isDestroyed = true;
    if (this.nitro) this.nitro.destroy();
    if (this.chassisGfx) this.chassisGfx.destroy();
    if (this.wheelGfx) this.wheelGfx.destroy();
    try {
      this.scene.matter.world.remove(this.chassis);
      this.scene.matter.world.remove(this.frontWheel);
      this.scene.matter.world.remove(this.rearWheel);
      this.scene.matter.world.remove(this.frontSpring);
      this.scene.matter.world.remove(this.rearSpring);
    } catch (e) {}
  }
}
