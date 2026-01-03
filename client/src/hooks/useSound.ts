import { useCallback, useRef } from "react";

interface SoundOptions {
  enabled: boolean;
}

// Create an oscillator-based sound effect
function createOscillatorSound(
  audioContext: AudioContext,
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume: number = 0.3
) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  
  gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
  
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

export function useSound({ enabled }: SoundOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  const playJump = useCallback(() => {
    if (!enabled) return;
    const ctx = getAudioContext();
    // Rising tone for jump
    createOscillatorSound(ctx, 300, 0.1, "sine", 0.2);
    setTimeout(() => createOscillatorSound(ctx, 400, 0.1, "sine", 0.15), 50);
  }, [enabled, getAudioContext]);

  const playCoin = useCallback(() => {
    if (!enabled) return;
    const ctx = getAudioContext();
    // Bright bling sound for coin
    createOscillatorSound(ctx, 800, 0.08, "sine", 0.2);
    setTimeout(() => createOscillatorSound(ctx, 1200, 0.1, "sine", 0.15), 60);
  }, [enabled, getAudioContext]);

  const playGameOver = useCallback(() => {
    if (!enabled) return;
    const ctx = getAudioContext();
    // Descending tones for game over
    createOscillatorSound(ctx, 400, 0.2, "sawtooth", 0.2);
    setTimeout(() => createOscillatorSound(ctx, 300, 0.2, "sawtooth", 0.15), 150);
    setTimeout(() => createOscillatorSound(ctx, 200, 0.3, "sawtooth", 0.1), 300);
  }, [enabled, getAudioContext]);

  const playSiren = useCallback(() => {
    if (!enabled) return;
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.type = "sine";
    // Alternating siren frequencies
    oscillator.frequency.setValueAtTime(600, ctx.currentTime);
    oscillator.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.15);
    oscillator.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.3);
    
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
  }, [enabled, getAudioContext]);

  const playVineGrab = useCallback(() => {
    if (!enabled) return;
    const ctx = getAudioContext();
    // Whoosh sound for vine grab
    createOscillatorSound(ctx, 200, 0.15, "triangle", 0.15);
  }, [enabled, getAudioContext]);

  const playVineRelease = useCallback(() => {
    if (!enabled) return;
    const ctx = getAudioContext();
    // Rising whoosh for release
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(200, ctx.currentTime);
    oscillator.frequency.linearRampToValueAtTime(500, ctx.currentTime + 0.15);
    
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15);
  }, [enabled, getAudioContext]);

  return {
    playJump,
    playCoin,
    playGameOver,
    playSiren,
    playVineGrab,
    playVineRelease,
  };
}
