// Dialogue boost and volume levelling for the page's own player, with Web Audio. The video's
// sound only goes through Web Audio once one of them is switched on (that can't be undone
// for the element, so it then stays routed and the effects are bypassed when switched off).

import { useEffect, useRef, type RefObject } from "react";

export interface SoundPrefs {
  /** Lift the voice band and tame the rumble under it, so speech carries. */
  dialogue: boolean;
  /** Compress loud and quiet parts towards one level (night mode). */
  level: boolean;
}

interface Graph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  nodes: AudioNode[];
}

/** Lows under dialogue down, the 1–4 kHz voice band up, sibilance eased. */
function dialogueChain(ctx: AudioContext): AudioNode[] {
  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 200;
  low.gain.value = -5;
  const voice = ctx.createBiquadFilter();
  voice.type = "peaking";
  voice.frequency.value = 2400;
  voice.Q.value = 0.8;
  voice.gain.value = 6;
  const air = ctx.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 9000;
  air.gain.value = -2;
  return [low, voice, air];
}

/** Squeezes the range: quiet passages come up, explosions come down. */
function levelChain(ctx: AudioContext): AudioNode[] {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -34;
  comp.knee.value = 12;
  comp.ratio.value = 5;
  comp.attack.value = 0.005;
  comp.release.value = 0.35;
  const makeup = ctx.createGain();
  makeup.gain.value = 2;
  return [comp, makeup];
}

/** Catches peaks the boosts would push into clipping. */
function limiter(ctx: AudioContext): AudioNode {
  const l = ctx.createDynamicsCompressor();
  l.threshold.value = -2;
  l.knee.value = 0;
  l.ratio.value = 20;
  l.attack.value = 0.001;
  l.release.value = 0.1;
  return l;
}

/**
 * Applies the chosen effects to a video element. `supported` is false where the browser
 * plays the stream itself (native HLS on Safari and TVs), whose sound Web Audio can't
 * reach: it would go silent.
 */
export function useAudioEffects(video: RefObject<HTMLVideoElement | null>, prefs: SoundPrefs, supported: boolean) {
  const graph = useRef<Graph | null>(null);
  const wanted = prefs.dialogue || prefs.level;

  useEffect(() => {
    const el = video.current;
    if (!el || (!graph.current && (!wanted || !supported))) return;
    let cancelled = false;
    (async () => {
      if (!graph.current) {
        const ctx = new AudioContext({ latencyHint: "playback" });
        await ctx.resume().catch(() => {});
        // A context that isn't running would silence the video once connected: leave it be.
        if (cancelled || ctx.state !== "running") {
          ctx.close().catch(() => {});
          return;
        }
        graph.current = { ctx, source: ctx.createMediaElementSource(el), nodes: [] };
      }
      const g = graph.current;
      g.source.disconnect();
      g.nodes.forEach((n) => n.disconnect());
      g.nodes = [...(prefs.dialogue ? dialogueChain(g.ctx) : []), ...(prefs.level ? levelChain(g.ctx) : [])];
      if (g.nodes.length) g.nodes.push(limiter(g.ctx));
      [g.source, ...g.nodes].reduce((from, to) => (from.connect(to), to));
      (g.nodes[g.nodes.length - 1] ?? g.source).connect(g.ctx.destination);
    })();
    return () => {
      cancelled = true;
    };
  }, [video, prefs.dialogue, prefs.level, wanted, supported]);

  // The context can be suspended by the browser (background tab); wake it with playback.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const wake = () => graph.current?.ctx.state === "suspended" && graph.current.ctx.resume().catch(() => {});
    el.addEventListener("play", wake);
    return () => el.removeEventListener("play", wake);
  }, [video]);

  useEffect(
    () => () => {
      graph.current?.ctx.close().catch(() => {});
      graph.current = null;
    },
    [],
  );
}
