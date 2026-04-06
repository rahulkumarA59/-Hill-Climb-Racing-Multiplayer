// ============================================================================
// LevelConfig.js — Per-level settings with physics overrides
// ============================================================================
// Each level defines terrain shape, colors, timer, and optional physics
// overrides that get merged into PhysicsConfig at runtime.
//
// Physics override philosophy:
//   - Every map gets a COMPLETE vehicle tuning profile
//   - Overrides are merged onto the base CAR_PHYSICS via spread operator
//   - Only override what NEEDS to change — base config handles everything else
//   - Core controls (throttle ramp, brake force, governor) stay consistent
//     across all maps to preserve vehicle identity
// ============================================================================

const LEVEL_CONFIGS = {
  1: {
    name: 'Green Meadows',
    description: 'Smooth rolling hills — perfect for beginners',
    difficulty: 'Easy',
    timer: 120,
    targetDistance: 5000,
    terrain: {
      baseAmplitude: 60,
      amplitudeVariation: 30,
      baseFrequency: 0.003,
      frequencyVariation: 0.001,
      smoothness: 0.85,
      hasGaps: false,
      gapChance: 0,
      gapWidth: 0,
      hasObstacles: false,
      obstacleChance: 0
    },
    colors: {
      sky: ['#87CEEB', '#4A90D9', '#2C5F8A'],
      groundTop: '#4CAF50',
      groundFill: '#3E8E41',
      groundDark: '#2E7D32',
      mountain: '#5D8A5E'
    },
    gravity: 1.0,

    // Physics: Default — the base PhysicsConfig IS Level 1.
    physics: {}
  },

  2: {
    name: 'Desert Canyon',
    description: 'Rocky terrain with gaps — test your skills',
    difficulty: 'Medium',
    timer: 90,
    targetDistance: 4000,
    terrain: {
      baseAmplitude: 120,
      amplitudeVariation: 60,
      baseFrequency: 0.006,
      frequencyVariation: 0.003,
      smoothness: 0.7,
      hasGaps: true,
      gapChance: 0.03,
      gapWidth: 120,
      hasObstacles: true,
      obstacleChance: 0.02
    },
    colors: {
      sky: ['#F4A460', '#E8853A', '#CC6A2E'],
      groundTop: '#D2961B',
      groundFill: '#B8860B',
      groundDark: '#8B6914',
      mountain: '#A0785A'
    },
    gravity: 1.2,

    // Desert: sandy terrain = less grip, more engine power needed
    physics: {
      wheelFriction: 0.7,           // Sand reduces traction
      accelerationForce: 0.007,     // More power for sand resistance
      chassisFrictionAir: 0.035,    // Dry desert air
      suspensionDamping: 0.22,      // Stiffer to handle rough terrain
      wheelRestitution: 0.02,       // Slightly more wheel bounce on rocks
    }
  },

  3: {
    name: 'Volcanic Peaks',
    description: 'Extreme slopes and obstacles — only for the brave',
    difficulty: 'Hard',
    timer: 60,
    targetDistance: 3000,
    terrain: {
      baseAmplitude: 200,
      amplitudeVariation: 100,
      baseFrequency: 0.009,
      frequencyVariation: 0.005,
      smoothness: 0.55,
      hasGaps: true,
      gapChance: 0.05,
      gapWidth: 160,
      hasObstacles: true,
      obstacleChance: 0.04
    },
    colors: {
      sky: ['#2C1810', '#4A1A0A', '#6B2D10'],
      groundTop: '#5C3A1E',
      groundFill: '#4A2E18',
      groundDark: '#3B2312',
      mountain: '#3D2B1F'
    },
    gravity: 1.5,

    // Volcanic: loose terrain + heavy gravity = brutal
    physics: {
      wheelFriction: 0.6,           // Loose volcanic rock
      accelerationForce: 0.009,     // Strong engine for steep climbs
      maxSpeed: 6,                  // Lower top speed (dangerous terrain)
      chassisFrictionAir: 0.042,    // Thicker atmosphere near volcano
      suspensionDamping: 0.24,      // More controlled suspension
      airTiltTorque: 0.03,          // Extra air control for big jumps
      flipTimeout: 2500,            // Slightly less forgiving on flips
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  HIGHWAY — High-Speed Stability Profile
  // ════════════════════════════════════════════════════════════════════════
  4: {
    name: 'Highway',
    description: 'High-speed thrills with jumps, dips & chaos',
    difficulty: 'Medium',
    timer: 150,
    targetDistance: 6000,
    terrain: {
      type: 'highway',
      baseAmplitude: 80,
      amplitudeVariation: 20,
      baseFrequency: 0.0015,
      frequencyVariation: 0.0005,
      smoothness: 1.0,
      hasGaps: false,
      gapChance: 0,
      gapWidth: 0,
      hasObstacles: false,
      obstacleChance: 0
    },
    colors: {
      sky: ['#5CACEE', '#1E90FF', '#0000CD'],
      groundTop: '#FFD700',
      groundFill: '#333333',
      groundDark: '#222222',
      mountain: '#888888'
    },
    gravity: 1.0,

    // Highway: smooth asphalt = maximum grip + speed + landing stability
    physics: {
      // Engine: high top speed with strong acceleration
      maxSpeed: 9,                  // Fast highway speeds
      accelerationForce: 0.0075,    // Quick speed buildup
      maxReverseSpeed: 3.0,         // Slightly faster reverse for recovery

      // Grip: asphalt = excellent traction
      wheelFriction: 1.1,           // Strong asphalt grip
      chassisFriction: 0.6,         // Chassis slides less on smooth road

      // Suspension: firm for high-speed stability
      suspensionDamping: 0.4,       // Extra damping absorbs bumps at speed
      wheelRestitution: 0.005,      // Almost zero bounce on landings

      // Air: low drag for maintaining speed through jumps
      chassisFrictionAir: 0.0008,   // Minimal air resistance
      airTiltTorque: 0.028,         // Moderate air control

      // Stability: high-speed demands more stability
      maxAngularVelocity: 0.07,     // Slightly limited spin (safer at speed)

      // Flip: forgiving — highway jumps are fast but recoverable
      flipTimeout: 3500,            // Extra recovery time at high speed
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  MOON — Floaty Low-Gravity Profile
  // ════════════════════════════════════════════════════════════════════════
  5: {
    name: 'Moon',
    description: 'Floaty craters and low gravity flipping',
    difficulty: 'Medium',
    timer: 120,
    targetDistance: 4000,
    terrain: {
      type: 'crater',
      baseAmplitude: 150,
      amplitudeVariation: 80,
      baseFrequency: 0.003,
      frequencyVariation: 0.002,
      smoothness: 1.0,
      hasGaps: true,
      gapChance: 0.02,
      gapWidth: 200,
      hasObstacles: false,
      obstacleChance: 0
    },
    colors: {
      sky: ['#050510', '#111122', '#1a1a3a'],
      groundTop: '#B0C4DE',
      groundFill: '#778899',
      groundDark: '#2F4F4F',
      mountain: '#4F4F4F'
    },
    gravity: 0.4,

    // Moon: low gravity = floaty, dusty, long airtime
    physics: {
      // Engine: slightly reduced — less gravity means less resistance
      maxSpeed: 7.0,                // Don't need extreme speed with low gravity
      accelerationForce: 0.005,     // Gentler acceleration (less traction available)

      // Grip: dusty regolith = reduced traction with slight slip feel
      wheelFriction: 0.55,          // Low grip lunar dust
      chassisFriction: 0.35,        // Chassis slides on dusty surface
      wheelRestitution: 0.04,       // Slight bounce on rocky crater landings

      // Suspension: softer to absorb gentle lunar landings
      suspensionDamping: 0.15,      // Soft damping — car "floats" slightly on landing
      wheelDriveForce: 0.10,        // Less wheel drive (wheels spin easier in dust)

      // Air: near-vacuum = zero air resistance, maximum air control
      chassisFrictionAir: 0.0001,   // Vacuum — no air drag at all
      airTiltTorque: 0.045,         // HIGH air control — key for moon flips
      maxAngularVelocity: 0.10,     // Allow faster spinning for backflips

      // Stability: relaxed — let the player feel the floatiness
      groundStabilization: 0.02,    // Less self-righting force

      // Flip: very forgiving — long airtime means more recovery opportunity
      flipTimeout: 4000,            // 4 seconds to recover (lots of airtime)
    }
  },

  // ════════════════════════════════════════════════════════════════════════
  //  ROOFTOP — Precision Platforming Profile
  // ════════════════════════════════════════════════════════════════════════
  6: {
    name: 'Rooftop',
    description: 'Jump across buildings — skill-based platforming',
    difficulty: 'Hard',
    timer: 90,
    targetDistance: 3000,
    terrain: {
      type: 'building',
      baseAmplitude: 250,
      amplitudeVariation: 150,
      baseFrequency: 0.004,
      frequencyVariation: 0.002,
      smoothness: 0,
      hasGaps: true,
      gapChance: 0.08,
      gapWidth: 300,
      hasObstacles: false,
      obstacleChance: 0
    },
    colors: {
      sky: ['#4B0082', '#2A0845', '#11001C'],
      groundTop: '#8A2BE2',
      groundFill: '#1A1A1A',
      groundDark: '#0A0A0A',
      mountain: '#200030'
    },
    gravity: 1.1,

    // Rooftop: precision control on short platforms with gap jumps
    physics: {
      // Engine: punchy acceleration for short runways, good top speed for gaps
      maxSpeed: 8.5,                // Need speed to clear gaps
      accelerationForce: 0.0085,    // Quick torque response on short platforms
      brakeForce: 0.012,            // Strong brakes — need to stop precisely

      // Grip: concrete = excellent traction for precise control
      wheelFriction: 1.1,           // Strong concrete grip
      chassisFriction: 0.6,         // No chassis sliding
      wheelDriveForce: 0.14,        // Responsive wheel drive

      // Suspension: stiff for flat surface stability
      suspensionDamping: 0.4,       // Very firm — no wobble on flat rooftops
      wheelRestitution: 0.005,      // Nearly zero bounce on landing

      // Air: moderate drag, good control for precise gap jumps
      chassisFrictionAir: 0.001,    // Normal air resistance
      airTiltTorque: 0.035,         // High air control for adjusting landing angle
      maxAngularVelocity: 0.09,     // Allow enough spin for corrections

      // Stability: strong self-righting on the narrow platforms
      groundStabilization: 0.04,    // Strong stabilization — can't afford to wobble

      // Flip: slightly less forgiving — rooftop demands precision
      flipTimeout: 2500,            // Shorter recovery window
    }
  }
};

export default LEVEL_CONFIGS;
