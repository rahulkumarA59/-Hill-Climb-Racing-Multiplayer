class SoundManager {
  constructor() {
    // We defer context creation until first user interaction
    // due to browser autoplay policies.
    this.context = null;
    this.masterGain = null;
    this.engineOscillator = null;
    this.engineGain = null;
    this.isMuted = false;
    this.engineStarted = false;
    this.bgmPlaying = false;
    this.nextNoteTime = 0;
    this.bgmInterval = null;
    this.lobbyBgmPlaying = false;
    this.lobbyBgmInterval = null;
  }

  init() {
    if (this.context || this.isMuted) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContext();
      
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.5; // Overall volume
      this.masterGain.connect(this.context.destination);

      this.initEngineSound();
    } catch (e) {
      console.warn('Web Audio API not supported', e);
    }
  }

  initEngineSound() {
    if (!this.context) return;
    
    // We will use 3 oscillators to simulate a combustion engine
    // Osc 1: The low rumble
    this.engineOsc1 = this.context.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    
    // Osc 2: The meaty body (square wave)
    this.engineOsc2 = this.context.createOscillator();
    this.engineOsc2.type = 'square';
    
    // Osc 3: High frequency overtone (triangle)
    this.engineOsc3 = this.context.createOscillator();
    this.engineOsc3.type = 'triangle';

    // The AM (Amplitude Modulation) to simulate cylinder firing "putt-putt"
    this.amOsc = this.context.createOscillator();
    this.amOsc.type = 'sine';
    this.amGain = this.context.createGain();
    
    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0;
    
    this.engineFilter = this.context.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    
    // Setup routing
    // Osc 1,2,3 -> AM Gain -> Filter -> Engine Gain -> Master
    this.engineOsc1.connect(this.amGain);
    this.engineOsc2.connect(this.amGain);
    this.engineOsc3.connect(this.amGain);
    
    this.amOsc.connect(this.amGain.gain); // AM modulation
    
    this.amGain.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);
    
    // Start nodes
    this.engineOsc1.start();
    this.engineOsc2.start();
    this.engineOsc3.start();
    this.amOsc.start();
    
    // Initial values will be set by updateEngine
    this.updateEngine(0, false);
  }

  startEngine() {
    if (!this.context) this.init();
    if (this.context && this.context.state === 'suspended') {
      this.context.resume();
    }
    if (this.engineGain && !this.engineStarted) {
      // Fade in the engine sound louder
      this.engineGain.gain.setTargetAtTime(0.3, this.context.currentTime, 0.5);
      this.engineStarted = true;
      if (!this.bgmPlaying) this.startBGM();
    }
  }

  updateEngine(speed, isAccelerating) {
    if (!this.engineOsc1 || !this.engineStarted || this.isMuted || !this.context) return;

    // RPM mapping (speed goes roughly 0 to 80)
    const clampedSpeed = Math.min(Math.max(Math.abs(speed), 0), 100);
    
    // Base frequency representing engine RPM
    // Idle at 30Hz, redlines around 120Hz
    let rpmBase = 30 + (clampedSpeed * 0.8);
    
    // Filter opens up as engine revs
    let filterFreq = 300 + (clampedSpeed * 15);
    
    // AM modulation rate (cylinder firing rate)
    // Faster RPM = faster puttering
    let amRate = (rpmBase / 2);

    if (isAccelerating) {
      // Pushing the gas adds instant load (pitch jump, open throat)
      rpmBase += 20; 
      filterFreq += 800;
    }

    const t = this.context.currentTime;
    // Main tone
    this.engineOsc1.frequency.setTargetAtTime(rpmBase, t, 0.1);
    
    // Sub octave for body
    this.engineOsc2.frequency.setTargetAtTime(rpmBase / 2, t, 0.1);
    
    // Higher harmonic
    this.engineOsc3.frequency.setTargetAtTime(rpmBase * 2.5, t, 0.1);
    
    // Adjust AM oscillator rate (the "putt putt putt" speed)
    this.amOsc.frequency.setTargetAtTime(amRate, t, 0.1);
    
    // Adjust overall brightness
    this.engineFilter.frequency.setTargetAtTime(filterFreq, t, 0.1);
  }

  stopEngine() {
    if (this.engineGain) {
      this.engineGain.gain.setTargetAtTime(0, this.context.currentTime, 0.5);
      this.engineStarted = false;
    }
    this.stopBGM();
  }

  playCoinSound() {
    if (!this.context || this.isMuted) return;

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = 'sine';
    // Arpeggio up for a "bling" sound
    osc.frequency.setValueAtTime(800, this.context.currentTime);
    osc.frequency.setValueAtTime(1200, this.context.currentTime + 0.05);

    gain.gain.setValueAtTime(0, this.context.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, this.context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.context.currentTime + 0.35);
  }

  playFuelSound() {
    if (!this.context || this.isMuted) return;

    // A bubbling "liquid gulp" sound using multiple oscillators
    for (let i = 0; i < 3; i++) {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      
      osc.type = 'sine';
      // start low, jump high quickly
      const startTime = this.context.currentTime + (i * 0.08);
      osc.frequency.setValueAtTime(300 + (i * 100), startTime);
      osc.frequency.exponentialRampToValueAtTime(800 + (i * 100), startTime + 0.1);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
      gain.gain.linearRampToValueAtTime(0.01, startTime + 0.15);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + 0.16);
    }
  }

  playCrashSound() {
    if (!this.context || this.isMuted) return;

    // Create a short burst of white noise
    const bufferSize = this.context.sampleRate * 0.5; // 0.5 seconds of noise
    const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    const noise = this.context.createBufferSource();
    noise.buffer = buffer;

    // Filter it to sound more like a low thud instead of TV static
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.8, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.4);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start();
  }

  playFinishSound() {
    if (!this.context || this.isMuted) return;

    // Play a major arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const dur = 0.15;

    notes.forEach((freq, i) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      const t = this.context.currentTime + (i * dur);
      
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, t + dur * 2);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + dur * 2);
    });
  }

  playVictorySound() {
    if (!this.context || this.isMuted) return;

    // Trumpet-like major fanfare
    const notes = [
      { freq: 523.25, time: 0, dur: 0.15 }, // C5
      { freq: 659.25, time: 0.15, dur: 0.15 }, // E5
      { freq: 783.99, time: 0.30, dur: 0.15 }, // G5
      { freq: 1046.50, time: 0.45, dur: 0.4 }  // C6 (held)
    ];

    notes.forEach(({ freq, time, dur }) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();

      osc.type = 'sawtooth'; // Brighter, brassy texture for victory
      osc.frequency.setValueAtTime(freq, this.context.currentTime + time);

      const t = this.context.currentTime + time;
      
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, t + dur);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + dur);
    });
  }

  playDefeatSound() {
    if (!this.context || this.isMuted) return;

    // Sad descending minor sound: G4 -> F4 -> D#4 -> D4
    const notes = [
      { freq: 392.00, time: 0, dur: 0.3 },    // G4
      { freq: 349.23, time: 0.3, dur: 0.3 },  // F4
      { freq: 311.13, time: 0.6, dur: 0.3 },  // D#4
      { freq: 293.66, time: 0.9, dur: 0.8 }   // D4 (held)
    ];

    notes.forEach(({ freq, time, dur }) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();

      osc.type = 'triangle'; // Mellow, sad tone
      osc.frequency.setValueAtTime(freq, this.context.currentTime + time);

      // Slight pitch slide down for the final note
      if (freq === 293.66) {
        osc.frequency.exponentialRampToValueAtTime(277.18, this.context.currentTime + time + dur); // slide to C#4
      }

      const t = this.context.currentTime + time;
      
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, t + dur);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + dur + 0.5);
    });
  }

  playPauseSound() {
    if (!this.context || this.isMuted) return;
    // Descending tone — signals a stop
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.context.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.context.currentTime + 0.25);
  }

  playResumeSound() {
    if (!this.context || this.isMuted) return;
    // Ascending tone — signals a start
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, this.context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(700, this.context.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.context.currentTime + 0.25);
  }

  playNitroSound() {
    if (!this.context || this.isMuted) return;
    const t = this.context.currentTime;

    // Layer 1: Rising whoosh (filtered noise)
    const bufferSize = this.context.sampleRate * 0.6;
    const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.context.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.context.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(500, t);
    noiseFilter.frequency.exponentialRampToValueAtTime(4000, t + 0.3);
    noiseFilter.Q.value = 2;

    const noiseGain = this.context.createGain();
    noiseGain.gain.setValueAtTime(0, t);
    noiseGain.gain.linearRampToValueAtTime(0.4, t + 0.08);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(t);

    // Layer 2: Power tone sweep (sawtooth rising)
    const osc1 = this.context.createOscillator();
    const gain1 = this.context.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(100, t);
    osc1.frequency.exponentialRampToValueAtTime(600, t + 0.25);
    osc1.frequency.exponentialRampToValueAtTime(200, t + 0.5);

    gain1.gain.setValueAtTime(0, t);
    gain1.gain.linearRampToValueAtTime(0.2, t + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

    osc1.connect(gain1);
    gain1.connect(this.masterGain);
    osc1.start(t);
    osc1.stop(t + 0.55);

    // Layer 3: High-pitched boost "zing"
    const osc2 = this.context.createOscillator();
    const gain2 = this.context.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(800, t);
    osc2.frequency.exponentialRampToValueAtTime(2000, t + 0.15);

    gain2.gain.setValueAtTime(0, t);
    gain2.gain.linearRampToValueAtTime(0.15, t + 0.03);
    gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

    osc2.connect(gain2);
    gain2.connect(this.masterGain);
    osc2.start(t);
    osc2.stop(t + 0.3);
  }

  pauseAllSounds() {
    // Suspend the entire AudioContext to freeze all oscillators & BGM
    if (this.context && this.context.state === 'running') {
      this.context.suspend();
    }
  }

  resumeAllSounds() {
    if (this.context && this.context.state === 'suspended') {
      this.context.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 0.5, this.context.currentTime, 0.1);
    }
    return this.isMuted;
  }

  // Very simple racing BGM arpeggiator
  startBGM() {
    if (!this.context || this.isMuted || this.bgmPlaying) return;
    this.bgmPlaying = true;
    this.nextNoteTime = this.context.currentTime + 0.1;
    this.bgmStep = 0;
    
    // Racing bassline E minor
    this.bgmNotes = [
      164.81, 164.81, 196.00, 164.81, 
      220.00, 164.81, 246.94, 164.81,
      130.81, 130.81, 146.83, 146.83,
      164.81, 164.81, 164.81, 164.81
    ];

    this.bgmInterval = setInterval(() => {
      while (this.nextNoteTime < this.context.currentTime + 0.1) {
        this.scheduleBGMNote(this.bgmNotes[this.bgmStep], this.nextNoteTime);
        this.nextNoteTime += 0.15; // tempo
        this.bgmStep = (this.bgmStep + 1) % this.bgmNotes.length;
      }
    }, 25);
  }

  scheduleBGMNote(freq, time) {
    if (!this.context) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    
    osc.type = 'square';
    osc.frequency.value = freq;
    
    // Snappy envelope for bass synth
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.08, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
    
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, time);
    filter.frequency.exponentialRampToValueAtTime(100, time + 0.1);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(time);
    osc.stop(time + 0.15);
  }

  stopBGM() {
    this.bgmPlaying = false;
    if (this.bgmInterval) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
  }

  // Lobby BGM
  startLobbyBGM() {
    if (!this.context) this.init();
    if (this.context && this.context.state === 'suspended') {
      this.context.resume();
    }
    if (this.isMuted || this.lobbyBgmPlaying) return;
    
    this.lobbyBgmPlaying = true;
    this.nextNoteTime = this.context.currentTime + 0.1;
    this.bgmStep = 0;
    
    const C = 261.63, E = 329.63, G = 392.00, A = 220.00, F = 174.61, D = 293.66, B = 246.94;
    this.lobbyNotes = [
      [C, E, G], [C, E, G],
      [A, C, E], [A, C, E],
      [F, A, C], [F, A, C],
      [G, B, D], [G, B, D]
    ];

    this.lobbyBgmInterval = setInterval(() => {
      while (this.nextNoteTime < this.context.currentTime + 0.1) {
        this.scheduleLobbyChord(this.lobbyNotes[this.bgmStep], this.nextNoteTime);
        this.nextNoteTime += 0.8;
        this.bgmStep = (this.bgmStep + 1) % this.lobbyNotes.length;
      }
    }, 100);
  }

  scheduleLobbyChord(freqs, time) {
    if (!this.context) return;
    
    freqs.forEach(freq => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.04, time + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 1.2);
      
      osc.connect(gain);
      gain.connect(this.masterGain);
      
      osc.start(time);
      osc.stop(time + 1.5);
    });
  }

  stopLobbyBGM() {
    this.lobbyBgmPlaying = false;
    if (this.lobbyBgmInterval) {
      clearInterval(this.lobbyBgmInterval);
      this.lobbyBgmInterval = null;
    }
  }
}

export const soundManager = new SoundManager();
