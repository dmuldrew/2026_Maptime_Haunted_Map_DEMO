// Gothic Ambient Sound Generator using Web Audio API
// 100% synthesized - zero external audio files needed

class HauntedAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.droneGain = null;
    this.isMuted = true;
    this.isPlaying = false;
    this.oscillators = [];
  }

  init() {
    if (this.ctx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.5, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.setValueAtTime(this.isMuted ? 0 : 0.35, this.ctx.currentTime);
    this.droneGain.connect(this.masterGain);

    this.setupDrone();
  }

  setupDrone() {
    if (!this.ctx) return;
    // Ambient dark drone frequencies (D minor fundamental & eerie fifths/octaves)
    const freqs = [73.42, 110.0, 146.83, 220.0]; // D2, A2, D3, A3
    
    // Low-pass filter to create muffled subterranean resonance
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, this.ctx.currentTime);
    filter.Q.setValueAtTime(3, this.ctx.currentTime);
    filter.connect(this.droneGain);

    // Subtle LFO for breathing wind movement
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.12, this.ctx.currentTime);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(90, this.ctx.currentTime);
    lfo.connect(filter.frequency);
    lfo.start();

    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f + (Math.random() * 0.8 - 0.4), this.ctx.currentTime);
      
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.08 / (i + 1), this.ctx.currentTime);
      osc.connect(g);
      g.connect(filter);
      osc.start();
      this.oscillators.push(osc);
    });
  }

  toggleSound() {
    if (!this.ctx) {
      this.init();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    } else {
      this.masterGain.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.2);
      this.droneGain.gain.setTargetAtTime(0.35, this.ctx.currentTime, 1.2);
    }
    return !this.isMuted;
  }

  // Play a haunting medieval church / cathedral bell toll
  playBell(pitchMultiplier = 1.0) {
    if (this.isMuted) return;
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const t = this.ctx.currentTime;
    const baseFreq = 216 * pitchMultiplier; // A3 harmonic
    const harmonics = [1, 2.01, 3.02, 4.2, 5.4];
    const decayTimes = [3.5, 2.4, 1.8, 1.2, 0.7];
    const amps = [0.3, 0.18, 0.12, 0.08, 0.04];

    harmonics.forEach((h, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * h, t);

      gain.gain.setValueAtTime(amps[idx], t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decayTimes[idx]);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + decayTimes[idx] + 0.1);
    });
  }

  // Play subtle ghostly chime for hover/selection
  playWhisper() {
    if (this.isMuted) return;
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, t); // D5
    osc.frequency.exponentialRampToValueAtTime(440, t + 0.35);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.4);
  }

  // Ambient ghostly sound bed layered under the spoken spooky narration
  startNarrationBed() {
    if (this.isMuted) return;
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    if (this.narrationGain) {
      this.stopNarrationBed();
    }

    const t = this.ctx.currentTime;
    this.narrationGain = this.ctx.createGain();
    this.narrationGain.gain.setValueAtTime(0.0001, t);
    this.narrationGain.gain.exponentialRampToValueAtTime(0.12, t + 0.8);
    this.narrationGain.connect(this.masterGain);

    // Deep subterranean resonant drone (D minor sub-bass)
    const subOsc = this.ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(55, t); // A1 sub-bass rumble

    // Filter to soften
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, t);

    subOsc.connect(filter);
    filter.connect(this.narrationGain);
    subOsc.start(t);
    this.narrationOsc = subOsc;
  }

  stopNarrationBed() {
    if (!this.narrationGain || !this.ctx) return;
    const gainToStop = this.narrationGain;
    const oscToStop = this.narrationOsc;
    this.narrationGain = null;
    this.narrationOsc = null;

    const t = this.ctx.currentTime;
    gainToStop.gain.cancelScheduledValues(t);
    gainToStop.gain.setValueAtTime(Math.max(0.0001, gainToStop.gain.value || 0.0001), t);
    gainToStop.gain.setTargetAtTime(0.0001, t, 0.4);
    setTimeout(() => {
      if (oscToStop) {
        try {
          oscToStop.stop();
          oscToStop.disconnect();
        } catch (e) {}
      }
      try {
        gainToStop.disconnect();
      } catch (e) {}
    }, 1200);
  }
}

window.hauntedAudio = new HauntedAudio();
