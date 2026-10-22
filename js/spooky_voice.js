// =========================================================================
// SPOOKY VOICE NARRATION & REAL-TIME TEXT HIGHLIGHTING ENGINE
// =========================================================================

class SpookyNarrator {
  constructor() {
    this.enabled = true; // Spooky voice enabled by default
    this.voiceStyle = 'phantom'; // 'phantom' | 'whisper' | 'demon' | 'vintage'
    this.voices = [];
    this.isSpeaking = false;
    this.isPaused = false;
    this.needsRespeak = false;
    this.activeUtterance = null;
    this.activeItem = null;
    this.activeStopNumber = null;
    this.activeWords = [];
    this.wordRanges = [];
    this.fullText = '';
    this.descOffset = 0;
    this.currentCharIndex = 0;
    this.currentWordIndex = -1;
    this.boundaryFired = false;
    this.wordInterval = null;
    this.fallbackTimeout = null;
    this.speakDelayTimeout = null;
    this.bannerHideTimeout = null;
    this.heartbeatInterval = null;
    this.lastCancelTime = 0;
    this.utteranceStartTime = 0;
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
    if (this.isSpeaking && this.activeItem) {
      this._startUtterance(this.currentCharIndex);
    } else if (this.isPaused) {
      this.needsRespeak = true;
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
    if (!this.enabled && (this.isSpeaking || this.isPaused)) {
      this.stop();
    }
    return this.enabled;
  }

  readStop(item, onFinish = null) {
    if (!this.enabled || !('speechSynthesis' in window)) {
      if (onFinish) onFinish();
      return;
    }

    // Clean up any previous speech state without hiding banner prematurely
    this._clearTimers();
    if (this.bannerHideTimeout) {
      clearTimeout(this.bannerHideTimeout);
      this.bannerHideTimeout = null;
    }
    this._detachUtterance();

    if ('speechSynthesis' in window) {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending || window.speechSynthesis.paused) {
        window.speechSynthesis.cancel();
        this.lastCancelTime = performance.now();
      }
    }

    document.querySelectorAll('.folklore-card').forEach(c => {
      if (c.id !== `card-${item.number}`) {
        c.classList.remove('reading-active');
        const titleEl = c.querySelector('.card-title');
        if (titleEl) titleEl.classList.remove('title-speaking');
        const wave = c.querySelector('.voice-wave-indicator');
        if (wave) wave.remove();
      }
    });

    this.activeItem = item;
    this.activeStopNumber = item.number;
    this.onFinishCallback = onFinish;
    this.currentCharIndex = 0;
    this.currentWordIndex = -1;
    this.boundaryFired = false;
    this.isPaused = false;
    this.needsRespeak = false;

    // Prepare text: Title followed by Description
    const titleText = item.title;
    const descText = item.description;
    this.fullText = `${titleText}. ${descText}`;
    this.descOffset = titleText.length + 2; // Character offset where description begins

    // Precalculate character ranges for each word in item.description
    this.wordRanges = [];
    const regex = /\S+/g;
    let match;
    while ((match = regex.exec(descText)) !== null) {
      this.wordRanges.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
        index: this.wordRanges.length
      });
    }

    // Visual start: highlight card & render tokenized words
    this.highlightCardStart(item);

    // Update Narration Subtitle Banner above dock
    this.updateNarrationBanner(item, true);

    // Initial state: highlight the title while speech begins
    this.highlightTitle(item.number);
    this.clearDescriptionHighlight(item.number);

    this._startUtterance(0);
  }

  _clearTimers() {
    if (this.speakDelayTimeout) {
      clearTimeout(this.speakDelayTimeout);
      this.speakDelayTimeout = null;
    }
    if (this.fallbackTimeout) {
      clearTimeout(this.fallbackTimeout);
      this.fallbackTimeout = null;
    }
    if (this.wordInterval) {
      clearInterval(this.wordInterval);
      this.wordInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  _detachUtterance() {
    if (this.activeUtterance) {
      this.activeUtterance.onboundary = null;
      this.activeUtterance.onend = null;
      this.activeUtterance.onerror = null;
      this.activeUtterance = null;
    }
  }

  _scheduleFallbackWordTimer(rate, delayMs, isResumingInDesc = false) {
    if (this.fallbackTimeout) clearTimeout(this.fallbackTimeout);
    if (this.wordInterval) clearInterval(this.wordInterval);
    const item = this.activeItem;
    if (!item) return;

    const estimatedWordMs = Math.max(340, Math.round(60000 / (115 * rate)));

    const startIntervalFrom = (startIdx) => {
      if (!this.isSpeaking || this.isPaused || this.activeStopNumber !== item.number || this.boundaryFired) {
        return;
      }
      this.unhighlightTitle(item.number);
      let fallbackWordIdx = Math.max(0, startIdx);

      // Highlight the initial word immediately upon entering description
      if (fallbackWordIdx < this.wordRanges.length) {
        this.currentWordIndex = fallbackWordIdx;
        this.currentCharIndex = this.descOffset + this.wordRanges[fallbackWordIdx].start;
        this.highlightWord(item.number, fallbackWordIdx);
        fallbackWordIdx++;
      }

      if (this.wordInterval) clearInterval(this.wordInterval);
      this.wordInterval = setInterval(() => {
        if (!this.isSpeaking || this.isPaused || this.activeStopNumber !== item.number || this.boundaryFired) {
          clearInterval(this.wordInterval);
          this.wordInterval = null;
          return;
        }
        if (fallbackWordIdx < this.wordRanges.length) {
          this.currentWordIndex = fallbackWordIdx;
          this.currentCharIndex = this.descOffset + this.wordRanges[fallbackWordIdx].start;
          this.highlightWord(item.number, fallbackWordIdx);
          fallbackWordIdx++;
        } else {
          clearInterval(this.wordInterval);
          this.wordInterval = null;
        }
      }, estimatedWordMs);
    };

    if (isResumingInDesc) {
      startIntervalFrom(Math.max(0, this.currentWordIndex));
    } else {
      this.fallbackTimeout = setTimeout(() => {
        this.fallbackTimeout = null;
        startIntervalFrom(Math.max(0, this.currentWordIndex));
      }, delayMs);
    }
  }

  _startUtterance(startCharOffset = 0, isRetry = false) {
    const item = this.activeItem;
    if (!item || !('speechSynthesis' in window)) return;

    this._clearTimers();
    this._detachUtterance();

    const textSlice = this.fullText.slice(startCharOffset);
    if (!textSlice.trim()) {
      this.handleSpeechEnd();
      return;
    }

    this.isSpeaking = true;
    this.isPaused = false;
    this.needsRespeak = false;
    this.boundaryFired = false;

    const playBtn = document.getElementById('tour-play-btn');
    if (playBtn) {
      playBtn.innerHTML = '❚❚';
      playBtn.title = 'Pause narration or tour';
    }

    if (window.hauntedAudio) {
      window.hauntedAudio.startNarrationBed();
    }

    this.highlightCardStart(item);
    const card = document.getElementById(`card-${item.number}`);
    if (card) {
      const wave = card.querySelector('.voice-wave-indicator');
      if (wave) wave.classList.remove('paused');
    }

    if (startCharOffset >= this.descOffset && this.currentWordIndex >= 0) {
      this.unhighlightTitle(item.number);
      this.highlightWord(item.number, this.currentWordIndex);
    }

    const synthBusy = window.speechSynthesis.speaking || window.speechSynthesis.pending || window.speechSynthesis.paused;
    if (synthBusy) {
      window.speechSynthesis.cancel();
      this.lastCancelTime = performance.now();
    }

    const timeSinceCancel = performance.now() - (this.lastCancelTime || 0);
    const delayMs = (synthBusy || timeSinceCancel < 80) ? 65 : 0;

    const launchSpeech = () => {
      this.speakDelayTimeout = null;
      if (!this.isSpeaking || this.isPaused || this.activeItem !== item) return;

      const utterance = new SpeechSynthesisUtterance(textSlice);
      const config = this.getVoiceConfig();
      if (config.voice) {
        utterance.voice = config.voice;
      }
      utterance.pitch = config.pitch;
      utterance.rate = config.rate;
      utterance.volume = 1.0;

      this.activeUtterance = utterance;
      this.utteranceStartTime = performance.now();

      // Browser onboundary event: maps EXACT charIndex in fullText
      utterance.onboundary = (e) => {
        if (this.activeUtterance !== utterance || this.isPaused) return;
        const relChar = typeof e.charIndex === 'number' ? e.charIndex : -1;

        // Only disable fallback timer once onboundary proves it fires word boundaries inside the description
        if (relChar > 0 && (startCharOffset + relChar) > this.descOffset) {
          this.boundaryFired = true;
          if (this.fallbackTimeout) {
            clearTimeout(this.fallbackTimeout);
            this.fallbackTimeout = null;
          }
          if (this.wordInterval) {
            clearInterval(this.wordInterval);
            this.wordInterval = null;
          }
        }

        if (relChar >= 0) {
          const charIndex = startCharOffset + relChar;
          this.currentCharIndex = charIndex;
          if (charIndex < this.descOffset) {
            // Synthesizer is currently reading the title words
            this.highlightTitle(item.number);
            this.clearDescriptionHighlight(item.number);
          } else {
            // Synthesizer is currently reading the description words!
            this.unhighlightTitle(item.number);
            const charInDesc = charIndex - this.descOffset;

            let targetWord = null;
            for (let i = 0; i < this.wordRanges.length; i++) {
              const w = this.wordRanges[i];
              if (charInDesc >= w.start && charInDesc <= w.end) {
                targetWord = w;
                break;
              }
            }
            if (!targetWord) {
              for (let i = 0; i < this.wordRanges.length; i++) {
                if (this.wordRanges[i].start >= charInDesc) {
                  targetWord = this.wordRanges[i];
                  break;
                }
              }
            }

            if (targetWord) {
              this.currentWordIndex = targetWord.index;
              this.currentCharIndex = this.descOffset + targetWord.start;
              this.highlightWord(item.number, targetWord.index);
            }
          }
        }
      };

      // Synchronized fallback timer if the voice does not fire word boundary events
      const isResumingInDesc = startCharOffset >= this.descOffset;
      this._scheduleFallbackWordTimer(config.rate, 1200, isResumingInDesc);

      utterance.onend = () => {
        if (this.activeUtterance !== utterance) return;
        if (this.isPaused) {
          this.needsRespeak = true;
          return;
        }
        this.handleSpeechEnd();
      };

      utterance.onerror = () => {
        if (this.activeUtterance !== utterance) return;
        if (this.isPaused) {
          this.needsRespeak = true;
          return;
        }
        // If browser canceled/interrupted the newly queued utterance due to async cancel IPC, retry once
        const elapsed = performance.now() - (this.utteranceStartTime || 0);
        if (!isRetry && elapsed < 600) {
          this.lastCancelTime = performance.now();
          this._startUtterance(this.currentCharIndex, true);
          return;
        }
        this.handleSpeechEnd();
      };

      window.speechSynthesis.speak(utterance);
    };

    if (delayMs > 0) {
      this.speakDelayTimeout = setTimeout(launchSpeech, delayMs);
    } else {
      launchSpeech();
    }
  }

  pause() {
    if (!this.isSpeaking || this.isPaused) return;
    this.isPaused = true;
    this.isSpeaking = false;

    this._clearTimers();
    this._detachUtterance();

    // Ensure currentCharIndex aligns cleanly with the start of the active word
    if (this.currentWordIndex >= 0 && this.wordRanges[this.currentWordIndex]) {
      this.currentCharIndex = this.descOffset + this.wordRanges[this.currentWordIndex].start;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.lastCancelTime = performance.now();
    }

    if (window.hauntedAudio) {
      window.hauntedAudio.stopNarrationBed();
    }

    if (this.activeStopNumber) {
      const card = document.getElementById(`card-${this.activeStopNumber}`);
      if (card) {
        const wave = card.querySelector('.voice-wave-indicator');
        if (wave) wave.classList.add('paused');
      }
    }

    const playBtn = document.getElementById('tour-play-btn');
    if (playBtn) {
      playBtn.innerHTML = '▶';
      playBtn.title = 'Resume narration';
    }
  }

  resume() {
    if (!this.isPaused || !this.activeItem) return;
    if (!this.enabled || !('speechSynthesis' in window)) {
      const cb = this.onFinishCallback;
      this.stop();
      if (cb) cb();
      return;
    }

    if (this.bannerHideTimeout) {
      clearTimeout(this.bannerHideTimeout);
      this.bannerHideTimeout = null;
    }

    this._startUtterance(this.currentCharIndex);
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
    this.isPaused = false;
    this.needsRespeak = false;
    this._clearTimers();
    this._detachUtterance();

    // Stop background spooky audio drone in Web Audio
    if (window.hauntedAudio) {
      window.hauntedAudio.stopNarrationBed();
    }

    // Clean up card visual state
    if (this.activeStopNumber) {
      this.unhighlightTitle(this.activeStopNumber);
      const card = document.getElementById(`card-${this.activeStopNumber}`);
      if (card) {
        card.classList.remove('reading-active');
        const wave = card.querySelector('.voice-wave-indicator');
        if (wave) wave.remove();

        card.querySelectorAll('.lore-word.word-speaking').forEach(w => {
          w.classList.remove('word-speaking');
          w.classList.add('word-spoken');
        });
      }
    }

    const bannerContainer = document.getElementById('narration-text');
    if (bannerContainer) {
      bannerContainer.querySelectorAll('.lore-word.word-speaking').forEach(w => {
        w.classList.remove('word-speaking');
        w.classList.add('word-spoken');
      });
    }

    // Fade subtitle banner smoothly after 2 seconds
    if (this.bannerHideTimeout) clearTimeout(this.bannerHideTimeout);
    this.bannerHideTimeout = setTimeout(() => {
      this.bannerHideTimeout = null;
      if (!this.isSpeaking && !this.isPaused) {
        this.updateNarrationBanner(null, false);
      }
    }, 2200);

    const cb = this.onFinishCallback;
    this.onFinishCallback = null;
    if (cb) cb();

    if (!window.tourActive && !window.tourPausedForSpeech) {
      const playBtn = document.getElementById('tour-play-btn');
      if (playBtn) {
        playBtn.innerHTML = '▶';
        playBtn.title = 'Play animated journey along route';
      }
    }
  }

  stop() {
    this.isSpeaking = false;
    this.isPaused = false;
    this.needsRespeak = false;
    this.activeItem = null;
    this._clearTimers();
    if (this.bannerHideTimeout) {
      clearTimeout(this.bannerHideTimeout);
      this.bannerHideTimeout = null;
    }
    this._detachUtterance();

    if ('speechSynthesis' in window) {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending || window.speechSynthesis.paused) {
        window.speechSynthesis.cancel();
        this.lastCancelTime = performance.now();
      }
    }
    if (window.hauntedAudio) {
      window.hauntedAudio.stopNarrationBed();
    }

    document.querySelectorAll('.folklore-card').forEach(c => {
      c.classList.remove('reading-active');
      const titleEl = c.querySelector('.card-title');
      if (titleEl) titleEl.classList.remove('title-speaking');
      const wave = c.querySelector('.voice-wave-indicator');
      if (wave) wave.remove();
    });

    const bannerTitle = document.querySelector('.narration-title-prefix');
    if (bannerTitle) bannerTitle.classList.remove('title-speaking');

    document.querySelectorAll('.lore-word').forEach(w => {
      w.classList.remove('word-speaking', 'word-spoken');
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
