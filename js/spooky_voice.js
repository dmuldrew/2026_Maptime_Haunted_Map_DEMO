// =========================================================================
// SPOOKY VOICE NARRATION & REAL-TIME TEXT HIGHLIGHTING ENGINE
// =========================================================================

class SpookyNarrator {
  constructor() {
    this.enabled = true; // Spooky voice enabled by default
    this.voiceStyle = 'phantom'; // 'phantom' | 'whisper' | 'demon' | 'vintage'
    this.voices = [];
    this.isSpeaking = false;
    this.activeUtterance = null;
    this.activeStopNumber = null;
    this.activeWords = [];
    this.wordInterval = null;
    this.heartbeatInterval = null;
    this.onFinishCallback = null;

    this.initVoices();
  }

  initVoices() {
    const loadVoices = () => {
      if (!('speechSynthesis' in window)) return;
      this.voices = window.speechSynthesis.getVoices();
    };
    loadVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  getVoiceConfig() {
    if (!this.voices || this.voices.length === 0) {
      if ('speechSynthesis' in window) {
        this.voices = window.speechSynthesis.getVoices();
      }
    }
    const voices = this.voices || [];

    let selectedVoice = null;
    let pitch = 0.62;
    let rate = 0.82;

    if (this.voiceStyle === 'whisper') {
      // 1. Ghost Whisper: Prioritize macOS native "Whisper" voice
      const whisper = voices.find(v => v.name.toLowerCase().includes('whisper'));
      if (whisper) {
        selectedVoice = whisper;
        pitch = 1.0;
        rate = 0.86;
      } else {
        // Fallback: breathy/softer English voice with lower pitch
        selectedVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
        pitch = 0.78;
        rate = 0.82;
      }
    } else if (this.voiceStyle === 'demon') {
      // 2. Shadow Demon: Ultra-deep resonant gravel
      selectedVoice = voices.find(v => v.name.includes('Albert') || v.name.includes('Fred') || v.name.includes('Daniel') || v.name.toLowerCase().includes('male')) ||
                      voices.find(v => v.lang.startsWith('en')) ||
                      voices[0];
      pitch = 0.38;
      rate = 0.76;
    } else if (this.voiceStyle === 'vintage') {
      // 3. Vintage Radio Narrator
      selectedVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
      pitch = 0.92;
      rate = 0.98;
    } else {
      // 4. Crypt Phantom (Default): Deep, theatrical Vincent Price / Christopher Lee gothic tone
      selectedVoice = voices.find(v => v.name.includes('Daniel')) ||
                      voices.find(v => v.name.includes('Oliver') || v.name.includes('Arthur')) ||
                      voices.find(v => v.name.includes('Google UK English Male')) ||
                      voices.find(v => v.name.toLowerCase().includes('bad news')) ||
                      voices.find(v => v.lang === 'en-GB') ||
                      voices.find(v => v.lang.startsWith('en')) ||
                      voices[0];
      pitch = 0.62;
      rate = 0.82;
    }

    return { voice: selectedVoice, pitch, rate };
  }

  setVoiceStyle(style) {
    this.voiceStyle = style;
    const bannerTag = document.getElementById('narration-voice-tag');
    if (bannerTag) {
      bannerTag.textContent = this.getStyleDisplayName();
    }
  }

  getStyleDisplayName() {
    switch (this.voiceStyle) {
      case 'whisper': return 'Ghost Whisper 👻';
      case 'demon':   return 'Shadow Demon 💀';
      case 'vintage': return 'Vintage Radio 📻';
      default:        return 'Crypt Phantom 🕯️';
    }
  }

  toggleEnabled() {
    this.enabled = !this.enabled;
    if (!this.enabled && this.isSpeaking) {
      this.stop();
    }
    return this.enabled;
  }

  readStop(item, onFinish = null) {
    if (!this.enabled || !('speechSynthesis' in window)) {
      if (onFinish) onFinish();
      return;
    }

    // Stop any ongoing speech
    this.stop();

    this.isSpeaking = true;
    this.activeStopNumber = item.number;
    this.onFinishCallback = onFinish;

    const playBtn = document.getElementById('tour-play-btn');
    if (playBtn) {
      playBtn.innerHTML = '❚❚';
      playBtn.title = 'Pause narration or tour';
    }

    // Start background spooky audio drone in Web Audio
    if (window.hauntedAudio) {
      window.hauntedAudio.startNarrationBed();
    }

    // Visual start: highlight card & render tokenized words
    this.highlightCardStart(item);

    // Prepare text: Title followed by Description
    const titleText = item.title;
    const descText = item.description;
    const fullText = `${titleText}. ${descText}`;
    const descOffset = titleText.length + 2; // Character offset where description begins

    const utterance = new SpeechSynthesisUtterance(fullText);

    const config = this.getVoiceConfig();
    if (config.voice) {
      utterance.voice = config.voice;
    }
    utterance.pitch = config.pitch;
    utterance.rate = config.rate;
    utterance.volume = 1.0;

    this.activeUtterance = utterance;

    // Precalculate character ranges for each word in item.description
    const wordRanges = [];
    const regex = /\S+/g;
    let match;
    while ((match = regex.exec(descText)) !== null) {
      wordRanges.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
        index: wordRanges.length
      });
    }

    // Update Narration Subtitle Banner above dock
    this.updateNarrationBanner(item, true);

    // Initial state: highlight the title while speech begins
    this.highlightTitle(item.number);
    this.clearDescriptionHighlight(item.number);

    let boundaryFired = false;

    // Browser onboundary event: maps EXACT charIndex in fullText
    utterance.onboundary = (e) => {
      boundaryFired = true;
      if (this.wordInterval) {
        clearInterval(this.wordInterval);
        this.wordInterval = null;
      }

      const charIndex = typeof e.charIndex === 'number' ? e.charIndex : -1;
      if (charIndex >= 0) {
        if (charIndex < descOffset) {
          // Synthesizer is currently reading the title words
          this.highlightTitle(item.number);
          this.clearDescriptionHighlight(item.number);
        } else {
          // Synthesizer is currently reading the description words!
          this.unhighlightTitle(item.number);
          const charInDesc = charIndex - descOffset;

          let targetWord = null;
          for (let i = 0; i < wordRanges.length; i++) {
            const w = wordRanges[i];
            if (charInDesc >= w.start && charInDesc <= w.end) {
              targetWord = w;
              break;
            }
          }
          if (!targetWord) {
            for (let i = 0; i < wordRanges.length; i++) {
              if (wordRanges[i].start >= charInDesc) {
                targetWord = wordRanges[i];
                break;
              }
            }
          }

          if (targetWord) {
            this.highlightWord(item.number, targetWord.index);
          }
        }
      }
    };

    // Synchronized fallback timer ONLY if the voice does not fire onboundary events
    setTimeout(() => {
      if (!boundaryFired && this.isSpeaking && this.activeStopNumber === item.number) {
        this.unhighlightTitle(item.number);
        let fallbackWordIdx = 0;
        const estimatedWordMs = Math.max(340, Math.round(60000 / (115 * config.rate)));
        this.wordInterval = setInterval(() => {
          if (!this.isSpeaking || this.activeStopNumber !== item.number || boundaryFired) {
            clearInterval(this.wordInterval);
            this.wordInterval = null;
            return;
          }
          if (fallbackWordIdx < wordRanges.length) {
            this.highlightWord(item.number, fallbackWordIdx);
            fallbackWordIdx++;
          } else {
            clearInterval(this.wordInterval);
            this.wordInterval = null;
          }
        }, estimatedWordMs);
      }
    }, 1400);

    // Chrome garbage collection keepalive heartbeat
    this.heartbeatInterval = setInterval(() => {
      if (!this.isSpeaking) {
        clearInterval(this.heartbeatInterval);
        return;
      }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, 10000);

    utterance.onend = () => {
      this.handleSpeechEnd();
    };

    utterance.onerror = () => {
      this.handleSpeechEnd();
    };

    window.speechSynthesis.speak(utterance);
  }

  highlightCardStart(item) {
    const card = document.getElementById(`card-${item.number}`);
    if (card) {
      card.classList.add('reading-active', 'highlighted');

      // Add audio wave indicator to title if not already present
      const titleEl = card.querySelector('.card-title');
      if (titleEl && !titleEl.querySelector('.voice-wave-indicator')) {
        const wave = document.createElement('span');
        wave.className = 'voice-wave-indicator';
        wave.innerHTML = '<span></span><span></span><span></span>';
        wave.title = 'Speaking lore...';
        titleEl.appendChild(wave);
      }
    }
  }

  highlightTitle(stopNumber) {
    const card = document.getElementById(`card-${stopNumber}`);
    if (card) {
      const titleEl = card.querySelector('.card-title');
      if (titleEl) titleEl.classList.add('title-speaking');
    }
    const bannerTitle = document.querySelector('.narration-title-prefix');
    if (bannerTitle) bannerTitle.classList.add('title-speaking');
  }

  unhighlightTitle(stopNumber) {
    const card = document.getElementById(`card-${stopNumber}`);
    if (card) {
      const titleEl = card.querySelector('.card-title');
      if (titleEl) titleEl.classList.remove('title-speaking');
    }
    const bannerTitle = document.querySelector('.narration-title-prefix');
    if (bannerTitle) bannerTitle.classList.remove('title-speaking');
  }

  clearDescriptionHighlight(stopNumber) {
    const container = document.getElementById(`card-desc-${stopNumber}`);
    if (container) {
      container.querySelectorAll('.lore-word').forEach(el => {
        el.className = 'lore-word';
      });
    }
    const bannerContainer = document.getElementById('narration-text');
    if (bannerContainer) {
      bannerContainer.querySelectorAll('.lore-word').forEach(el => {
        el.className = 'lore-word';
      });
    }
  }

  highlightWord(stopNumber, targetIdx) {
    // 1. Highlight word on the Map Story Card with exact past/current/future states
    const container = document.getElementById(`card-desc-${stopNumber}`);
    if (container) {
      const words = container.querySelectorAll('.lore-word');
      words.forEach((el, idx) => {
        if (idx < targetIdx) {
          el.className = 'lore-word word-spoken';
        } else if (idx === targetIdx) {
          el.className = 'lore-word word-speaking';
        } else {
          el.className = 'lore-word';
        }
      });
    }

    // 2. Highlight word in Subtitle Narration Banner
    const bannerContainer = document.getElementById('narration-text');
    if (bannerContainer) {
      const words = bannerContainer.querySelectorAll('.lore-word');
      words.forEach((el, idx) => {
        if (idx < targetIdx) {
          el.className = 'lore-word word-spoken';
        } else if (idx === targetIdx) {
          el.className = 'lore-word word-speaking';
        } else {
          el.className = 'lore-word';
        }
      });
    }
  }

  updateNarrationBanner(item, show = true) {
    const banner = document.getElementById('tour-narration-banner');
    if (!banner) return;

    if (!show) {
      banner.classList.add('hidden');
      return;
    }

    const voiceTag = document.getElementById('narration-voice-tag');
    if (voiceTag) {
      voiceTag.textContent = this.getStyleDisplayName();
    }

    const textEl = document.getElementById('narration-text');
    if (textEl) {
      const words = item.description.split(/\s+/).filter(w => w.length > 0);
      textEl.innerHTML = `<span class="narration-title-prefix">${item.title}:</span> ` +
        words.map((w, idx) => `<span class="lore-word" id="banner-word-${idx}">${w}</span>`).join(' ');
    }

    banner.classList.remove('hidden');
  }

  handleSpeechEnd() {
    this.isSpeaking = false;
    if (this.wordInterval) clearInterval(this.wordInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    // Stop background spooky audio drone in Web Audio
    if (window.hauntedAudio) {
      window.hauntedAudio.stopNarrationBed();
    }

    // Clean up card visual state
    if (this.activeStopNumber) {
      const card = document.getElementById(`card-${this.activeStopNumber}`);
      if (card) {
        card.classList.remove('reading-active');
        const wave = card.querySelector('.voice-wave-indicator');
        if (wave) wave.remove();

        const speakingWord = card.querySelector('.lore-word.word-speaking');
        if (speakingWord) {
          speakingWord.classList.remove('word-speaking');
          speakingWord.classList.add('word-spoken');
        }
      }
    }

    // Fade subtitle banner smoothly after 2 seconds
    setTimeout(() => {
      if (!this.isSpeaking) {
        this.updateNarrationBanner(null, false);
      }
    }, 2200);

    if (!window.tourActive && !window.tourPausedForSpeech) {
      const playBtn = document.getElementById('tour-play-btn');
      if (playBtn) {
        playBtn.innerHTML = '▶';
        playBtn.title = 'Play animated journey along route';
      }
    }

    const cb = this.onFinishCallback;
    this.onFinishCallback = null;
    if (cb) cb();
  }

  stop() {
    this.isSpeaking = false;
    if (this.wordInterval) clearInterval(this.wordInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (window.hauntedAudio) {
      window.hauntedAudio.stopNarrationBed();
    }

    document.querySelectorAll('.folklore-card').forEach(c => {
      c.classList.remove('reading-active');
      const wave = c.querySelector('.voice-wave-indicator');
      if (wave) wave.remove();
    });

    document.querySelectorAll('.lore-word').forEach(w => {
      w.classList.remove('word-speaking');
    });

    this.updateNarrationBanner(null, false);
    this.onFinishCallback = null;

    if (!window.tourActive && !window.tourPausedForSpeech) {
      const playBtn = document.getElementById('tour-play-btn');
      if (playBtn) {
        playBtn.innerHTML = '▶';
        playBtn.title = 'Play animated journey along route';
      }
    }
  }
}

window.spookyNarrator = new SpookyNarrator();
