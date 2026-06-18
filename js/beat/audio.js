const Audio = {
    isReady: false,
    hitSound: null,
    missSound: null,
    countdownTickSound: null,
    countdownStartSound: null,

    initializeSynths() {
        this.hitSound = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.005, decay: 0.05, sustain: 0, release: 0.1 }
        }).toDestination();

        this.missSound = new Tone.Synth({
            oscillator: { type: 'square' },
            envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.1 }
        }).toDestination();

        this.countdownTickSound = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0.1, release: 0.2 }
        }).toDestination();

        this.countdownStartSound = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0.1, release: 0.2 }
        }).toDestination();

        this.setSfxVolume(Game.state.settings.sfxVolume);
        this.setMusicVolume(Game.state.settings.musicVolume);
    },

    async start() {
        if (Audio.isReady) return;
        try {
            await Tone.start();
            this.initializeSynths();
            Audio.isReady = true;
            console.log("Audio context started and synths initialized");
        } catch (err) {
            Debugger.logError(err, 'Audio.start');
            console.error("Could not start audio context", err);
        }
    },

    playHitSound() {
        if (!this.isReady || !this.hitSound) return;
        const now = Tone.now();
        this.hitSound.triggerAttackRelease("G5", 0.05, now + 0.001);
    },

    playMissSound() {
        if (!this.isReady || !this.missSound) return;
        const now = Tone.now();
        this.missSound.triggerAttackRelease("C3", "8n", now + 0.001);
    },

    playCountdownTick() {
        if (!this.isReady || !this.countdownTickSound) return;
        const now = Tone.now();
        this.countdownTickSound.triggerAttackRelease("A4", "16n", now + 0.001);
    },

    playCountdownStart() {
        if (!this.isReady || !this.countdownStartSound) return;
        const now = Tone.now();
        this.countdownStartSound.triggerAttackRelease("A5", "8n", now + 0.001);
    },

    setMusicVolume(value) {
        const volume = value / 100;
        DOM.musicPlayer.volume = volume;
    },

    setSfxVolume(value) {
        if (!this.isReady) return;
        const db = (value - 100) * 0.5;
        const volume = (value === 0) ? -Infinity : db;
        this.hitSound.volume.value = volume;
        this.missSound.volume.value = volume;
        this.countdownTickSound.volume.value = volume;
        this.countdownStartSound.volume.value = volume;
    }
};
