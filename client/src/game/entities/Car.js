// ============================================================================
// Car.js — Player car entity with Terrain Climb Racing-style physics
// ============================================================================
// Uses Matter.js composite body: chassis + 2 wheels + spring constraints.
// Includes NitroSystem for temporary speed boosts.
// All physics constants come from the passed `physicsConfig` object.
//
// Driving model:
//   1. Throttle smoothly ramps up/down (no instant acceleration)
//   2. Engine force = mass × accelerationForce × throttle × governor
//   3. Governor smoothly tapers force as speed approaches maxSpeed
//   4. Brake applies opposing force, does NOT reverse until stopped
//   5. Reverse is a separate, slower mode
//   6. Wheels are driven via angular velocity (create traction via friction)
//   7. Suspension springs are soft with low damping for HCR-style bounce
// ============================================================================

import { CAR_PHYSICS } from '../PhysicsConfig.js';
import NitroSystem from './NitroSystem.js';

export default class Car {
  constructor(scene, x, y, color = '#ff4757', physicsOverrides = {}) {
    this.scene = scene;
    this.color = color;
    this.startX = x;

    // Merge default config with any per-level overrides
    this.config = { ...CAR_PHYSICS, ...physicsOverrides };

    // State tracking
    this.flipTimer = 0;
    this.isFlipped = false;
    this.isDestroyed = false;
    this.isRagdolling = false;
    this.maxDistance = 0;

    // Advanced Physics state
    this.previousIsGrounded = true;
    this.landingDampingFrames = 0;
    this.previousVelocity = null;

    // Flip tracking state
    this.lastAngle = 0;
    this.accumulatedAngle = 0;
    this.pendingFlips = 0;

    // Smooth input state machine
    this.throttle = 0;          // -1 (full reverse) → 0 (idle) → +1 (full gas)
    this.inputGas = false;      // Is gas button held this frame?
    this.inputBrake = false;    // Is brake button held this frame?
    this.inputTilt = 0;         // -1 (tilt back) → 0 → +1 (tilt forward)
    this.isBraking = false;     // True while car is decelerating from brake input
    this.isReversing = false;   // True once car has stopped and brake is still held

    // Nitro Boost System
    this.nitro = new NitroSystem(scene);

    this.createCar(x, y);
    this.createVisuals();
  }

  // ─── BODY CREATION ──────────────────────────────────────────────────

  createCar(x, y) {
    const cfg = this.config;

    // === CHASSIS ===
    // The main car body. Mass determines how the car responds to forces.
    // Chamfered corners prevent snagging on terrain edges.
    this.chassis = this.scene.matter.add.rectangle(
      x, y - 20,
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
          group: -1 // MUST be negative to ignore internal collision
        }
      }
    );

    // === WHEELS ===
    // Circles with high friction for terrain grip.
    // Slight restitution gives a small bounce on hard landings.
    const wheelOpts = {
      density: cfg.wheelDensity,
      friction: cfg.wheelFriction,
      frictionAir: 0.001, // Keep air resistance low for rapid wheel spinning
      restitution: cfg.wheelRestitution,
      label: 'wheel',
      collisionFilter: {
        category: 0x0002,
        mask: 0x0001,
        group: -1 // Connects with chassis group to prevent lap overlap bugs
      }
    };

    // === REVOLUTE JOINTS (HINGES) ===
    // Completely disable all spring physics.
    // Length 0 + Stiffness 1 creates a rigid pin joint allowing ONLY rotation.
    
    const chassisCenterY = y - 20; // Chassis is created at y - 20
    
    // We remove suspension distance entirely to attach wheels 
    // cleanly against the bottom of the chassis like a realistic car.
    const effectiveOffsetY = cfg.wheelOffsetY;

    this.rearWheel = this.scene.matter.add.circle(
      x - cfg.wheelOffsetX, chassisCenterY + effectiveOffsetY, cfg.wheelRadius, wheelOpts
    );
    this.frontWheel = this.scene.matter.add.circle(
      x + cfg.wheelOffsetX, chassisCenterY + effectiveOffsetY, cfg.wheelRadius, wheelOpts
    );

    const hingeOpts = {
      length: 1,      // Extremely subtle vertical give (micro-suspension)
      stiffness: 1,   // High stiffness prevents suspension from swallowing kinetic energy
      damping: 0.1,   // Low damping allows the physical kinetic force of a ramp to travel directly into chassis lift
    };

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
  }

  createVisuals() {
    this.chassisGfx = this.scene.add.graphics();
    this.chassisGfx.setDepth(10);

    this.wheelGfx = this.scene.add.graphics();
    this.wheelGfx.setDepth(9);

    this.lineGfx = this.scene.add.graphics();
    this.lineGfx.setDepth(8);
  }

  // ─── INPUT METHODS ────────────────────────────────────────────────────
  // Called by GameScene each frame based on key state.
  // These just set flags — actual physics is applied in applyPhysics().

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

  // ─── RAGDOLL (visual driver ejection on crash) ────────────────────────

  ejectRagdoll() {
    if (this.isDestroyed || this.isRagdolling) return;
    this.isRagdolling = true;

    const chassisAngle = this.chassis.angle;
    const cos = Math.cos(chassisAngle);
    const sin = Math.sin(chassisAngle);

    this.ragdollPos = {
      x: this.chassis.position.x + cos * -5 - sin * -30,
      y: this.chassis.position.y + sin * -5 + cos * -30
    };

    this.ragdollVelocity = {
      x: this.chassis.velocity.x + (Math.random() * 8 - 4),
      y: this.chassis.velocity.y - 10
    };
    this.ragdollAngle = chassisAngle;
  }

  // ─── CORE PHYSICS ─────────────────────────────────────────────────────

  applyPhysics(delta) {
    const Body = Phaser.Physics.Matter.Matter.Body;
    const cfg = this.config;
    const chassis = this.chassis;
    
    // Framerate independent input scaling
    const deltaScale = delta / 16.666;

    // ── Step 1: Calculate current forward speed ──
    const angle = chassis.angle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const forwardSpeed = chassis.velocity.x * cosA + chassis.velocity.y * sinA;
    const absSpeed = Math.abs(forwardSpeed);

    const isGrounded = this.isGrounded();

    // The entire Momentum Smoothing Filter (velocity clamp) has been strictly removed.
    // Vertical and horizontal momentum trajectories are now 100% physically preserved 
    // off ramps, allowing full ballistic airtime.
    this.previousVelocity = { x: chassis.velocity.x, y: chassis.velocity.y };

    // ── Airborne Physics & Momentum Conservation ──
    if (isGrounded) {
      // Smart Landing Absorption
      if (!this.previousIsGrounded) {
         this.landingDampingFrames = 15; // Allow 15 frames of damping
         
         // Flip validation upon safe landing (angle is relatively flat)
         const normalizeAngle = Math.abs(angle % (Math.PI * 2));
         const isSafeLanding = normalizeAngle < 1.0 || normalizeAngle > (Math.PI * 2 - 1.0);
         
         if (isSafeLanding && this.pendingFlips > 0) {
           const rewardCoins = this.pendingFlips === 1 ? 1000 : 1000 + (this.pendingFlips - 1) * 2000;
           this.scene.events.emit('airFlipCompleted', {
             flips: this.pendingFlips,
             x: chassis.position.x,
             y: chassis.position.y - 80,
             reward: rewardCoins
           });
         }
         
         // Reset airborne stats upon touching ground
         this.accumulatedAngle = 0;
         this.pendingFlips = 0;
      }
    
      chassis.frictionAir = cfg.chassisFrictionAir;
      this.lastAngle = angle;
      
      // Dynamic Traction System: Base friction on steepness
      let targetGrip = cfg.wheelFriction;
      const tiltRad = Math.abs(angle);
      if (tiltRad > 0.6) {
        targetGrip *= 0.85; // Less grip on steep slopes
      } else if (tiltRad < 0.2) {
        targetGrip *= 1.1; // More grip on flat ground
      }
      this.currentWheelFriction = Phaser.Math.Linear(this.currentWheelFriction || targetGrip, targetGrip, 0.2 * deltaScale);
      
    } else {
      // Launched just now
      if (this.previousIsGrounded) {
         this.lastAngle = angle;
         this.accumulatedAngle = 0;
         this.pendingFlips = 0;
         
         // Smart Velocity Tilt Assist
         // Trigger if moving fast (absSpeed > 4) and pointing UP the ramp (angle < -0.1)
         if (absSpeed > 4 && angle < -0.1) {
             // 1. Proportional scale based on ramp steepness (max out around 35 degrees / 0.6 rads)
             const slopeFactor = Phaser.Math.Clamp(Math.abs(angle) / 0.6, 0, 1);
             
             // 2. Assist force is strictly bound to a small percentage of existing forward velocity
             const maxTiltSpeed = absSpeed * 0.12; 
             const verticalAssist = maxTiltSpeed * slopeFactor;
             
             // 3. Blend exactly with the existing velocity vector
             const newVy = chassis.velocity.y - verticalAssist;
             
             // 4. Strict Safety Clamp to prevent bizarre rocket launches
             const safeVy = Math.max(newVy, -14);
             
             Body.setVelocity(chassis, {
                 x: chassis.velocity.x, // Completely preserve horizontal momentum
                 y: safeVy              // Apply clamped aerodynamic vertical assist
             });
         }
      } else {
         // Mid-air Rotation Tracking
         const deltaAngle = Phaser.Math.Angle.Wrap(angle - this.lastAngle);
         this.accumulatedAngle += deltaAngle;
         this.lastAngle = angle;
         
         const newFlips = Math.floor(Math.abs(this.accumulatedAngle) / (Math.PI * 2));
         if (newFlips > this.pendingFlips) {
             this.pendingFlips = newFlips;
         }
      }

      // Controlled Air Rotation: Only damp spin if the player is NOT actively tilting
      if (this.inputTilt === 0) {
        Body.setAngularVelocity(chassis, chassis.angularVelocity * Math.pow(0.96, deltaScale));
      }

      chassis.frictionAir = 0.0005;
      this.currentWheelFriction = 0.2;
      
      const expectedAngVel = forwardSpeed / cfg.wheelRadius;
      Body.setAngularVelocity(this.rearWheel, expectedAngVel);
      Body.setAngularVelocity(this.frontWheel, expectedAngVel);
    }

    this.rearWheel.friction = this.currentWheelFriction;
    this.frontWheel.friction = this.currentWheelFriction;

    // Apply Smart Landing Absorption (Micro Shock)
    if (this.landingDampingFrames > 0) {
       Body.setAngularVelocity(chassis, chassis.angularVelocity * 0.9);
       this.landingDampingFrames -= deltaScale;
    }
    
    this.previousIsGrounded = isGrounded;

    // ── Step 2: Throttle state machine (Input Scaled) ──
    if (this.inputGas) {
      this.isBraking = false;
      this.isReversing = false;
      this.throttle = Math.min(this.throttle + cfg.throttleRampUp * deltaScale, 1.0);
    } else if (this.inputBrake) {
      if (forwardSpeed > 0.5) {
        this.isBraking = true;
        this.isReversing = false;
        this.throttle = Math.max(this.throttle - cfg.throttleRampDown * 2 * deltaScale, 0);
      } else {
        this.isBraking = false;
        this.isReversing = true;
        this.throttle = Math.max(this.throttle - cfg.throttleRampUp * 0.6 * deltaScale, -1.0);
      }
    } else {
      this.isBraking = false;
      this.isReversing = false;
      this.throttle *= Math.pow(cfg.engineBraking, deltaScale);
      if (Math.abs(this.throttle) < 0.01) this.throttle = 0;
    }

    // ── Step 3: Engine force (with Nitro integration) ──
    // Nitro multipliers
    const nitroForceMultiplier = this.nitro.getForceMultiplier();
    const nitroSpeedMultiplier = this.nitro.getSpeedCapMultiplier();

    if (this.throttle !== 0 && isGrounded) {
      const mass = chassis.mass || 12;
      const baseMaxSpeed = this.throttle > 0 ? cfg.maxSpeed : cfg.maxReverseSpeed;
      const currentMaxSpeed = baseMaxSpeed * nitroSpeedMultiplier;

      let governor = 1.0;
      const speedRatio = absSpeed / currentMaxSpeed;
      if (speedRatio > 0.7) {
        const overspeed = Math.max(0, speedRatio - 0.7) / 0.3;
        governor = 1.0 / (1.0 + Math.pow(overspeed * 2, cfg.governorSharpness));
      }

      const forceMult = this.throttle > 0 ? cfg.accelerationForce : cfg.reverseForce;
      
      // Torque Curve Refinement: Smooth non-linear delivery
      const smoothThrottle = Phaser.Math.Easing.Sine.Out(Math.abs(this.throttle));
      const thrustMagnitude = mass * forceMult * smoothThrottle * governor * nitroForceMultiplier;
      const thrustDir = this.throttle > 0 ? 1 : -1;
      
      const fx = cosA * thrustMagnitude * thrustDir;
      const fy = sinA * thrustMagnitude * thrustDir;

      Body.applyForce(chassis, chassis.position, { x: fx, y: fy });

      const wheelSpin = cfg.wheelDriveForce * thrustDir * governor * nitroForceMultiplier;

      Body.setAngularVelocity(
        this.rearWheel,
        Phaser.Math.Clamp(this.rearWheel.angularVelocity + wheelSpin * deltaScale, -cfg.maxWheelAngVel * nitroSpeedMultiplier, cfg.maxWheelAngVel * nitroSpeedMultiplier)
      );
      Body.setAngularVelocity(
        this.frontWheel,
        Phaser.Math.Clamp(this.frontWheel.angularVelocity + wheelSpin * cfg.frontWheelDriveRatio * deltaScale, -cfg.maxWheelAngVel * nitroSpeedMultiplier, cfg.maxWheelAngVel * nitroSpeedMultiplier)
      );
    }

    // ── Step 4: Brake force ──
    if (this.isBraking && absSpeed > 0.3 && isGrounded) {
      const mass = chassis.mass || 12;
      const brakeMag = mass * cfg.brakeForce;
      const brakeDir = forwardSpeed > 0 ? -1 : 1;
      Body.applyForce(chassis, chassis.position, { x: cosA * brakeMag * brakeDir, y: sinA * brakeMag * brakeDir });

      Body.setAngularVelocity(this.rearWheel, this.rearWheel.angularVelocity * Math.pow(0.9, deltaScale));
      Body.setAngularVelocity(this.frontWheel, this.frontWheel.angularVelocity * Math.pow(0.9, deltaScale));
    }

    // ── Step 5: Wheel-based Tilt / Control Torque ──
    if (this.inputTilt !== 0) {
      if (isGrounded) {
        const tiltTorque = this.inputTilt * cfg.airTiltTorque * 2.5 * deltaScale; 
        
        const newRearAngVel = Phaser.Math.Clamp(
          this.rearWheel.angularVelocity + tiltTorque,
          -cfg.maxWheelAngVel, cfg.maxWheelAngVel
        );
        Body.setAngularVelocity(this.rearWheel, newRearAngVel);

        const newFrontAngVel = Phaser.Math.Clamp(
          this.frontWheel.angularVelocity + tiltTorque,
          -cfg.maxWheelAngVel, cfg.maxWheelAngVel
        );
        Body.setAngularVelocity(this.frontWheel, newFrontAngVel);
      } else {
        // Natural airborne rotation driven solely by tilt torque, no artificial boost
        const tiltForce = this.inputTilt * cfg.airTiltTorque * deltaScale;
        Body.setAngularVelocity(
          chassis,
          Phaser.Math.Clamp(
            chassis.angularVelocity + tiltForce,
            -cfg.maxAngularVelocity, 
            cfg.maxAngularVelocity
          )
        );
      }
    }

    // ── Step 6: Soft Stability Assist (Non-Intrusive Anti-Flip) ──
    // Only active in extreme instability (>70 degrees)
    if (isGrounded && Math.abs(angle) > 1.2) {
      const correctiveMagnitude = 0.005 * (Math.abs(angle) - 1.2) * deltaScale;
      const correctiveTorque = angle > 0 ? -correctiveMagnitude : correctiveMagnitude;
      Body.setAngularVelocity(chassis, chassis.angularVelocity + correctiveTorque);
    }

    // ── Step 7: Nitro Stabilization ──
    // During active nitro, dampen angular velocity to prevent instability
    if (this.nitro.isActive && isGrounded) {
      const stabFactor = this.nitro.getStabilizationFactor();
      Body.setAngularVelocity(chassis, chassis.angularVelocity * Math.pow(stabFactor, deltaScale));
    }
  }

  // ─── GROUND CONTACT CHECK ─────────────────────────────────────────────
  // Uses Matter.js active collision pairs to check if wheels are touching
  // terrain. Much more reliable than distance-based checks.

  isGrounded() {
    const pairs = this.scene.matter.world.engine.pairs.list;
    const rearId = this.rearWheel.id;
    const frontId = this.frontWheel.id;

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (!pair.isActive) continue;
      
      // Wheel Contact Refinement: Prevent micro-floating false positives
      if (pair.collision && pair.collision.depth < 0.1) continue;

      const aId = pair.bodyA.id;
      const bId = pair.bodyB.id;
      const aLabel = pair.bodyA.label;
      const bLabel = pair.bodyB.label;

      if ((aId === rearId || aId === frontId) && bLabel === 'terrain') return true;
      if ((bId === rearId || bId === frontId) && aLabel === 'terrain') return true;
    }
    return false;
  }

  // ─── GETTERS ──────────────────────────────────────────────────────────

  getPosition() {
    if (this.isDestroyed) return { x: 0, y: 0 };
    return { x: this.chassis.position.x, y: this.chassis.position.y };
  }

  getRotation() {
    if (this.isDestroyed) return 0;
    return this.chassis.angle;
  }

  getVelocity() {
    if (this.isDestroyed) return { x: 0, y: 0 };
    return { x: this.chassis.velocity.x, y: this.chassis.velocity.y };
  }

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
    const pxPerFrame = Math.sqrt(vx * vx + vy * vy);
    return pxPerFrame * this.config.speedDisplayScale;
  }

  // Returns throttle position for sound engine (-1 to +1)
  getThrottle() {
    return this.throttle;
  }

  // ─── FLIP DETECTION ───────────────────────────────────────────────────
  // Car is "flipped" if upside-down continuously for flipTimeout ms.
  // Brief flips (during jumps) don't trigger game over.

  checkFlip(delta) {
    if (this.isDestroyed) return false;
    const cfg = this.config;

    // Normalize angle to 0 → 2π
    let angle = this.chassis.angle % (Math.PI * 2);
    if (angle < 0) angle += Math.PI * 2;

    const isUpsideDown = (angle > cfg.flipAngleMin && angle < cfg.flipAngleMax) ||
                          (angle > (Math.PI * 2 - cfg.flipAngleMax) &&
                           angle < (Math.PI * 2 - cfg.flipAngleMin));

    if (isUpsideDown) {
      this.flipTimer += delta;
      if (this.flipTimer > cfg.flipTimeout) {
        // Crash invalidator
        this.accumulatedAngle = 0;
        this.pendingFlips = 0;
        
        this.isFlipped = true;
        return true;
      }
    } else {
      // Decay flip timer quickly when rightside-up (forgiveness)
      this.flipTimer = Math.max(0, this.flipTimer - delta * 2);
    }
    return false;
  }

  // ─── VISUAL RENDERING ─────────────────────────────────────────────────
  // All drawing code below is purely visual — no physics impact.

  drawCar() {
    if (this.isDestroyed) return;

    const chassisPos = this.chassis.position;
    const chassisAngle = this.chassis.angle;
    const frontPos = this.frontWheel.position;
    const rearPos = this.rearWheel.position;

    const colorNum = Phaser.Display.Color.HexStringToColor(this.color).color;
    const darkerColor = Phaser.Display.Color.HexStringToColor(this.color).darken(30).color;

    // --- Draw Vector Jeep Chassis ---
    const cg = this.chassisGfx;
    cg.clear();
    cg.setPosition(chassisPos.x, chassisPos.y);
    cg.setRotation(chassisAngle);

    // Main buggy body plate
    cg.fillStyle(colorNum, 1);
    cg.beginPath();
    cg.moveTo(-45, 10);
    cg.lineTo(45, 10);
    cg.lineTo(48, -4);
    cg.lineTo(25, -12);
    cg.lineTo(-30, -12);
    cg.lineTo(-48, -4);
    cg.closePath();
    cg.fill();

    // Buggy Roll Cage (tubes)
    cg.lineStyle(4, 0x444444, 1);
    cg.beginPath();
    cg.moveTo(20, -12);
    cg.lineTo(5, -40);
    cg.lineTo(-25, -40);
    cg.lineTo(-40, -10);
    cg.strokePath();

    cg.beginPath();
    cg.moveTo(-5, -40);
    cg.lineTo(-5, -12);
    cg.strokePath();

    // Seat
    cg.fillStyle(0x222222, 1);
    cg.fillRoundedRect(-20, -25, 10, 20, 3);
    cg.fillRect(-15, -10, 20, 8);

    // Steering wheel
    cg.lineStyle(3, 0x111111, 1);
    cg.beginPath();
    cg.moveTo(15, -10);
    cg.lineTo(10, -20);
    cg.strokePath();
    cg.fillStyle(0x111111, 1);
    cg.fillCircle(10, -20, 6);

    // --- Draw Driver ---
    if (!this.isRagdolling) {
      const leanOffset = Phaser.Math.Clamp(this.chassis.angularVelocity * 10, -5, 5);

      // Torso (Yellow shirt)
      cg.fillStyle(0xFFD700, 1);
      cg.fillRoundedRect(-11 + leanOffset * 0.5, -34, 14, 25, 6);

      // Arm reaching to steering wheel
      cg.lineStyle(5, 0xFFD700, 1);
      cg.beginPath();
      cg.moveTo(-5 + leanOffset * 0.5, -30);
      cg.lineTo(7, -25);
      cg.lineTo(13, -20);
      cg.strokePath();

      // Hand
      cg.fillStyle(0xFFCDB2, 1);
      cg.fillCircle(13, -20, 4);

      // Head (Helmet)
      cg.fillStyle(0xAAAAAA, 1);
      cg.fillCircle(-4 + leanOffset, -40, 10);
      cg.fillStyle(0x111111, 1);
      cg.fillRect(0 + leanOffset, -44, 6, 8);
    }

    // Engine block detail
    cg.fillStyle(0x555555, 1);
    cg.fillRect(-40, -15, 15, 12);
    cg.fillStyle(0x888888, 1);
    cg.fillRect(-35, -20, 5, 8);

    // Headlight
    cg.fillStyle(0xFFFF00, 0.9);
    cg.fillCircle(45, -2, 5);

    // --- Draw Wheels ---
    const wg = this.wheelGfx;
    wg.clear();

    // Ragdoll driver (drawn on wheel layer for correct world-space positioning)
    if (this.isRagdolling) {
      wg.fillStyle(0xAAAAAA, 1);
      wg.fillCircle(this.ragdollPos.x, this.ragdollPos.y, 10);
      wg.fillStyle(0xFFD700, 1);
      wg.fillRoundedRect(this.ragdollPos.x - 7, this.ragdollPos.y + 10, 14, 25, 6);
    }

    this.drawWheel(wg, frontPos.x, frontPos.y, this.config.wheelRadius, this.frontWheel.angle);
    this.drawWheel(wg, rearPos.x, rearPos.y, this.config.wheelRadius, this.rearWheel.angle);

    // Suspension line drawing has been completely removed to match
    // the rigid body mounting of normal vehicles.
  }

  drawWheel(g, x, y, radius, angle) {
    // Detailed off-road tire
    g.fillStyle(0x111111, 1);
    g.fillCircle(x, y, radius);

    // Jagged treads
    g.lineStyle(3, 0x000000, 1);
    for (let i = 0; i < 12; i++) {
      const a = angle + (i * Math.PI / 6);
      const ex = x + Math.cos(a) * (radius + 2);
      const ey = y + Math.sin(a) * (radius + 2);
      g.lineBetween(
        x + Math.cos(a) * radius * 0.8,
        y + Math.sin(a) * radius * 0.8,
        ex, ey
      );
    }

    // Rim
    g.fillStyle(0xDDDDDD, 1);
    g.fillCircle(x, y, radius * 0.65);

    // Inner rim
    g.fillStyle(0x222222, 1);
    g.fillCircle(x, y, radius * 0.45);

    // Hub
    g.fillStyle(0xFFFF00, 1);
    g.fillCircle(x, y, radius * 0.2);

    // 5 Spokes
    g.lineStyle(3, 0xDDDDDD, 1);
    for (let i = 0; i < 5; i++) {
      const a = angle + (i * Math.PI * 2 / 5);
      const ex = x + Math.cos(a) * radius * 0.65;
      const ey = y + Math.sin(a) * radius * 0.65;
      g.lineBetween(x, y, ex, ey);
    }
  }

  // ─── NITRO ────────────────────────────────────────────────────────────

  activateNitro() {
    if (this.isDestroyed || this.isFlipped || this.isRagdolling) return false;
    return this.nitro.activate();
  }

  getNitroHudData() {
    return this.nitro.getHudData();
  }

  // ─── UPDATE LOOP ──────────────────────────────────────────────────────

  update(delta) {
    if (this.isDestroyed) return;

    // Update nitro system every frame
    this.nitro.update(delta);

    if (this.isRagdolling) {
      // Simple gravity for ejected driver visual
      this.ragdollPos.x += this.ragdollVelocity.x;
      this.ragdollPos.y += this.ragdollVelocity.y;
      this.ragdollVelocity.y += 0.5;
      this.ragdollAngle += 0.1;
    } else {
      // Core physics
      this.applyPhysics(delta);

      // Nitro flame particles (spawn behind vehicle)
      if (this.nitro.isActive) {
        this.nitro.spawnNitroFlame(
          this.chassis.position.x,
          this.chassis.position.y,
          this.chassis.angle
        );
      }
    }

    this.drawCar();

    // Reset input flags for next frame
    this.inputGas = false;
    this.inputBrake = false;
    this.inputTilt = 0;
  }

  // ─── CLEANUP ──────────────────────────────────────────────────────────

  destroy() {
    this.isDestroyed = true;
    if (this.nitro) { this.nitro.destroy(); }
    if (this.chassisGfx) { this.chassisGfx.destroy(); this.chassisGfx = null; }
    if (this.wheelGfx) { this.wheelGfx.destroy(); this.wheelGfx = null; }
    if (this.lineGfx) { this.lineGfx.destroy(); this.lineGfx = null; }
    try {
      this.scene.matter.world.remove(this.chassis);
      this.scene.matter.world.remove(this.frontWheel);
      this.scene.matter.world.remove(this.rearWheel);
      this.scene.matter.world.remove(this.frontSpring);
      this.scene.matter.world.remove(this.rearSpring);
    } catch (e) {
      // Bodies may already be removed
    }
  }
}
