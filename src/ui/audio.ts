/** Original oscillator cues; no third-party recordings, device input, or permissions. */
export class AudioCues {
  private context: AudioContext | null = null;
  muted = false;
  volume = 0.25;

  unlock(): void {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
    } catch { /* Audio is optional; the visual feedback remains complete. */ }
  }

  play(kind: string): void {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const alarm = /breach|失效|link/i.test(kind);
    const freq = alarm ? 185 : /skill|技能/i.test(kind) ? 640 : /suppress|恢复/i.test(kind) ? 520 : 390;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = alarm ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, this.context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * (alarm ? 0.65 : 1.4), this.context.currentTime + 0.14);
    gain.gain.setValueAtTime(this.volume * 0.15, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.18);
    osc.connect(gain).connect(this.context.destination);
    osc.start();
    osc.stop(this.context.currentTime + 0.19);
  }
}
