const Audio = {
    isReady: false,
    countdownTickSound: null,
    countdownStartSound: null,

    initializeSynths() {
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
        this.countdownTickSound.volume.value = volume;
        this.countdownStartSound.volume.value = volume;
    }
};