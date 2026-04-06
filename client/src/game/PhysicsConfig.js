// ============================================================================
// PhysicsConfig.js — Central tunable physics parameters
// ============================================================================
// Every magic number that affects car behavior lives here.
// Adjust these to change how the car FEELS without touching game logic.
//
// Philosophy: Terrain Climb Racing feel
//   • Slow start → smooth buildup → capped top speed
//   • Uphill = natural slowdown, Downhill = natural speedup
//   • Bouncy suspension, the car "breathes" over terrain
//   • Mid-air rotation is fun but not instant
//   • Braking stops the car first, THEN allows slow reverse
//   • Car self-stabilizes on ground — doesn't flip from small bumps
// ============================================================================

export const CAR_PHYSICS = {

  // ─── ENGINE ───────────────────────────────────────────────────────────

  maxSpeed: 7.5,
  maxReverseSpeed: 2.7,
  accelerationForce: 0.0065,
  brakeForce: 0.009,
  reverseForce: 0.003,
  throttleRampUp: 0.05,
  throttleRampDown: 0.03,
  engineBraking: 0.90,
  governorSharpness: 5.0,

  // ─── CHASSIS ──────────────────────────────────────────────────────────
  // Wider + heavier = much more stable. Hard to flip from small bumps.

  chassisWidth: 100,         // Was 90 — wider body = lower tip-over chance
  chassisHeight: 24,         // Was 28 — flatter profile = lower center of gravity

  // Heavier chassis = more rotational inertia = resists flipping.
  // Area = 100×24 = 2400. density 0.008 → mass ≈ 19.2 (was ~12.6)
  chassisDensity: 0.008,

  chassisFriction: 0.5,
  chassisFrictionAir: 0.001, // Greatly reduced to prevent mid-air slowing/hovering
  chassisRestitution: 0.01,  // Almost 0 to prevent bouncing on hard landings

  // Larger chamfer = very rounded corners. Prevents catching terrain edges.
  chassisChamfer: 12,        // Was 8

  // ─── WHEELS ───────────────────────────────────────────────────────────

  wheelRadius: 16,           // Was 14 — bigger wheels = better ground clearance

  // Heavier wheels = lower center of gravity = more stable.
  // Area = π×16² ≈ 804. density 0.004 → mass ≈ 3.2 each (was 1.85)
  wheelDensity: 0.004,

  wheelFriction: 0.9,        // Was 0.85 — more grip prevents sliding-induced flips
  wheelRestitution: 0.01,    // Was 0.15 -> 0.01 — almost no wheel bounce = prevents landing jerks

  wheelDriveForce: 0.12,
  maxWheelAngVel: 0.35,
  frontWheelDriveRatio: 0.3,

  // ─── SUSPENSION ───────────────────────────────────────────────────────
  // Stiffer + more damped = car doesn't rock as much over bumps.

  suspensionLength: 45,      // Was 22 -> 45 (firm static piston distance)
  suspensionStiffness: 0.95, // Was 0.45 -> 0.95 (strong constraint, heavily prevents stretching)
  suspensionDamping: 0.35,   // Was 0.3 -> 0.35 (damps any leftover micro-bounce to create realism)

  wheelOffsetX: 40,          // Was 35 — wider wheelbase = much harder to tip over
  wheelOffsetY: 14,          // Was 15

  // ─── STABILITY (NEW) ─────────────────────────────────────────────────
  // Auto-stabilization applies a corrective torque when the car tilts
  // while on the ground. This is the KEY feature that prevents flipping.

  // How strongly the car self-rights when tilted on ground.
  // 0 = no stabilization, 0.05 = strong self-righting.
  // This simulates a low center of gravity pulling the car upright.
  groundStabilization: 0.03,

  // Angular velocity damping when grounded.
  // Every frame, angular velocity is multiplied by this.
  // 0.85 = strong damping (resists rotation). 1.0 = no damping.
  groundAngularDamping: 0.85,

  // ─── ROTATION / TILT ──────────────────────────────────────────────────

  airTiltTorque: 0.025,
  groundTiltMultiplier: 0.15,
  maxAngularVelocity: 0.08,

  // ─── FLIP DETECTION ───────────────────────────────────────────────────

  flipAngleMin: 2.5,         // Was 2.3 — need to be more upside-down to count
  flipAngleMax: 3.8,         // Was 4.0 — narrower range = more forgiving
  flipTimeout: 3000,         // Was 2000 — 3 seconds to recover instead of 2

  // ─── DISPLAY ──────────────────────────────────────────────────────────

  speedDisplayScale: 7.2,
  distanceScale: 10,
};

// ============================================================================
// Bike Physics Configuration
// ============================================================================
export const BIKE_PHYSICS = {
  // ─── ENGINE ───────────────────────────────────────────────────────────
  maxSpeed: 8.0,             // Slightly above car for bike feel
  maxReverseSpeed: 1.8,
  accelerationForce: 0.007,  // Matched close to car (0.0065) — rigid joints transfer fully
  brakeForce: 0.009,
  reverseForce: 0.003,
  throttleRampUp: 0.05,      // Smooth ramp
  throttleRampDown: 0.06,
  engineBraking: 0.90,
  governorSharpness: 3.5,

  // ─── CHASSIS ──────────────────────────────────────────────────────────
  chassisWidth: 50,
  chassisHeight: 18,
  chassisDensity: 0.012,     // HEAVIER — lowers COM, prevents flipping
  chassisFriction: 0.5,
  chassisFrictionAir: 0.002, // MORE air drag — slows rotation in air
  chassisRestitution: 0.01,
  chassisChamfer: 6,

  // ─── WHEELS ───────────────────────────────────────────────────────────
  wheelRadius: 15,
  wheelDensity: 0.006,       // Heavier wheels = lower COM overall
  wheelFriction: 0.95,       // Strong grip for climbing
  wheelRestitution: 0.01,    // Tiny bounce
  wheelDriveForce: 0.12,     // Match car level — rigid joints now transfer all force
  maxWheelAngVel: 0.40,
  frontWheelDriveRatio: 0.15,// Slight front drive helps on slopes

  // ─── JOINTS (RIGID PIN — same as car) ─────────────────────────────────
  // These values are now unused (joints are hardcoded rigid in Bike.js)
  // Kept for reference only
  suspensionLength: 1,
  suspensionStiffness: 1,
  suspensionDamping: 0.15,

  wheelOffsetX: 28,
  wheelOffsetY: 0,

  // ─── STABILITY ────────────────────────────────────────────────────────
  groundStabilization: 0.008, // Stronger auto-correction (was 0.002)
  groundAngularDamping: 0.92, // Strong rotation damping on ground

  // ─── ROTATION / TILT ──────────────────────────────────────────────────
  airTiltTorque: 0.03,       // Slightly reduced air control
  groundTiltMultiplier: 0.5, // Less aggressive ground lean
  maxAngularVelocity: 0.08,  // CAPPED rotation speed (was 0.12)

  // ─── FLIP DETECTION ───────────────────────────────────────────────────
  flipAngleMin: 1.8,
  flipAngleMax: 4.4,
  flipTimeout: 1500,

  // ─── DISPLAY ──────────────────────────────────────────────────────────
  speedDisplayScale: 7.2,
  distanceScale: 10,
};

// ============================================================================
// Item Placement Config
// ============================================================================

export const ITEM_CONFIG = {
  // ─── COIN CLUSTERS (DYNAMIC) ─────────────────────────────────────────
  
  clusterSpacingMin: 500,     // Minimum pixels between coin groups
  clusterSpacingMax: 900,     // Maximum pixels between coin groups
  coinClusterSizeMin: 4,      // Smallest number of coins in a cluster
  coinClusterSizeMax: 7,      // Largest number of coins in a cluster
  coinSpacingMin: 40,         // Minimum gap between coins
  coinSpacingMax: 65,         // Maximum gap between coins
  
  // Strict global height clamps
  coinMinHeight: 25,          // Minimum height above terrain (lowest possible)
  coinMaxHeight: 60,          // Maximum height above terrain (highest possible = jump limit)
  arcHeight: 25,              // Dynamic base height added to the middle coins to form an arc
  
  // ─── FUEL PLACEMENT (SMART) ──────────────────────────────────────────
  
  // The system uses real-time fuel efficiency to predict precisely when the car
  // will run out. It then places the fuel at this factor (e.g., 0.8 = 80%) of the
  // remaining calculated distance to create maximum tension without failing.
  fuelSafetyFactor: 0.8,
  
  // The algorithm searches the terrain for a safe drop spot.
  // 0.3 means no slope steeper than ~16 degrees for a safe drop zone
  maxFuelSlope: 0.3,

  // Absolute fallback distance in case of zero efficiency records early game
  fuelSpawnDistanceDefault: 4500,

  fuelHoverHeight: 30         // Sits precisely on the ground path
};

// ============================================================================
// NITRO BOOST CONFIG
// ============================================================================
export const NITRO_CONFIG = {
  maxUses: 2,                  // Uses per cycle before cooldown
  cooldownDuration: 45000,     // 45 seconds cooldown (ms)
  gapBetweenUses: 3000,        // 3 second minimum between uses (ms)
  boostDuration: 2500,         // 2.5 second nitro burst (ms)
  forceMultiplier: 2.2,        // Extra thrust multiplier during nitro
  speedCapBoost: 1.6,          // Temporarily raise max speed by this factor
  stabilization: 0.85,         // Angular velocity damping during nitro (prevents flip)
  fuelCost: 8,                 // Fuel consumed per nitro use
};
