import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GoogleGenAI, LiveServerMessage, Modality, Blob as GenAIBlob } from '@google/genai';

const PARTICLE_COUNT = 40000;

// --- Web Audio Helper Functions ---
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    // @ts-ignore
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data: Float32Array): GenAIBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

export default function GalaxyScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>('Initializing WebGL...');
  
  // Kinetic Typography State (Razor Sharp DOM Overlay)
  const [kineticText, setKineticText] = useState<{words: string[], activeIndex: number}>({ words: [], activeIndex: -1 });
  
  const streamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const aiWasPlayingRef = useRef(false);
  const clearTextTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let width = containerRef.current.clientWidth || window.innerWidth;
    let height = containerRef.current.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);
    scene.fog = new THREE.FogExp2(0x050510, 0.015);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 70;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const baseColors = new Float32Array(PARTICLE_COUNT * 3);
    const activeColors = new Float32Array(PARTICLE_COUNT * 3);
    const randoms = new Float32Array(PARTICLE_COUNT * 3);

    // Deep, moody palette (Used for 90% of idle state, and 100% of the active/zoomed state)
    const colorDeepPurple = new THREE.Color('#1A0033'); // Extremely dark purple
    const colorRoyalPurple = new THREE.Color('#4B0082'); // Deep rich purple
    const colorMutedViolet = new THREE.Color('#6A1B9A'); // Muted, moody violet
    
    // Shiny, vibrant cool star palette (Used EXCLUSIVELY for the other 10% during IDLE state)
    const colorCyanStar = new THREE.Color('#00E5FF'); 
    const colorSilverStar = new THREE.Color('#E0F7FA'); 

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = Math.pow(Math.random(), 1/3) * 35;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      
      let baseColor = new THREE.Color();
      let activeColor = new THREE.Color();
      const randColor = Math.random();

      // --- 1. SET IDLE COLORS (90% Moody Purples / 10% Shiny Cool Stars) ---
      if (randColor < 0.90) {
        // 90% Purples (Moody base)
        const p = Math.random();
        if (p < 0.4) {
          baseColor.copy(colorDeepPurple).lerp(colorRoyalPurple, Math.random());
        } else if (p < 0.8) {
          baseColor.copy(colorRoyalPurple).lerp(colorMutedViolet, Math.random());
        } else {
          baseColor.copy(colorMutedViolet).lerp(colorDeepPurple, Math.random());
        }
      } else if (randColor < 0.950) {
        // 5% Shiny Cyan Stars
        baseColor.copy(colorCyanStar);
      } else {
        // 5% Shiny Silver Stars
        baseColor.copy(colorSilverStar);
      }
      
      // --- 2. SET ACTIVE (ZOOMED/SPEAKING) COLORS ---
      // Strictly maintain the dark, moody, purple-dominant harmony here.
      // We generate a purely dark purple active color for EVERY particle.
      const pActive = Math.random();
      if (pActive < 0.6) {
        activeColor.copy(colorDeepPurple).lerp(colorRoyalPurple, Math.random());
      } else {
        activeColor.copy(colorRoyalPurple).lerp(colorMutedViolet, Math.random());
      }
      
      // Blend just a tiny fraction (10%) of the base color into the active color
      // to keep slight textual variety, but ensuring 90% is strictly moody purple.
      // This forces the shiny stars to turn dark and moody when the AI speaks.
      activeColor.lerp(baseColor, 0.1);

      baseColors[i * 3] = baseColor.r;
      baseColors[i * 3 + 1] = baseColor.g;
      baseColors[i * 3 + 2] = baseColor.b;
      
      activeColors[i * 3] = activeColor.r;
      activeColors[i * 3 + 1] = activeColor.g;
      activeColors[i * 3 + 2] = activeColor.b;

      randoms[i * 3] = Math.random();
      randoms[i * 3 + 1] = Math.random();
      randoms[i * 3 + 2] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('colorBase', new THREE.BufferAttribute(baseColors, 3));
    geometry.setAttribute('colorActive', new THREE.BufferAttribute(activeColors, 3));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 3));

    const uniforms = {
      uTime: { value: 0 },
      uVolume: { value: 0 }
    };

    const material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: `
        precision highp float;
        uniform float uTime;
        uniform float uVolume;

        attribute vec3 colorBase;
        attribute vec3 colorActive;
        attribute vec3 aRandom;

        varying vec3 vColor;
        varying vec3 vColorBase;
        varying vec3 vRandom;

        void main() {
          vRandom = aRandom;
          vColorBase = colorBase;

          vec3 posGalaxy = position;

          // Swirling galaxy logic
          float r = length(posGalaxy.xz);
          float angle = atan(posGalaxy.z, posGalaxy.x) + uTime * 0.1 + r * 0.05;
          posGalaxy.x = r * cos(angle);
          posGalaxy.z = r * sin(angle);
          posGalaxy.y += sin(uTime + posGalaxy.x * 0.1 + aRandom.y * 10.0) * 1.5;

          // Audio reactive outward push
          vec3 pushDir = normalize(posGalaxy + vec3(0.0001));
          float pushStrength = uVolume * (5.0 + aRandom.z * 15.0);
          vec3 finalPos = posGalaxy + pushDir * pushStrength;

          vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
          
          float pulseSize = 1.0 + (uVolume * 1.5 * aRandom.x);
          // Strong base size to ensure particles are highly visible when idle
          float baseSize = 4.5 * pulseSize; 
          
          gl_PointSize = baseSize * (100.0 / max(0.1, -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
          
          // Smooth transition between base colors and the moody purple-dominant active colors
          // Scales quickly so shiny stars disappear instantly when speaking starts
          float colorMix = clamp(uVolume * 3.0 + (aRandom.x * uVolume), 0.0, 1.0);
          vColor = mix(colorBase, colorActive, colorMix);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uVolume;

        varying vec3 vColor;
        varying vec3 vColorBase;
        varying vec3 vRandom;
        
        void main() {
          vec2 pt = gl_PointCoord - vec2(0.5);
          float distSq = dot(pt, pt);
          if(distSq > 0.25) discard;
          
          float alpha = 1.0 - smoothstep(0.1, 0.5, sqrt(distSq));
          
          // Calculate natural luminance of the base color
          float luma = dot(vColorBase, vec3(0.299, 0.587, 0.114));
          // Isolate shiny stars (high luminance) from moody purples (low luminance)
          float shinyFactor = smoothstep(0.15, 0.5, luma);
          
          // Force shiny stars to behave like moody purples when zooming/speaking
          float effectiveShiny = shinyFactor * (1.0 - clamp(uVolume * 4.0, 0.0, 1.0));
          
          // Complex, captivating shimmer for the 10% shiny cool stars
          float shimmerPhase = uTime * 3.0 + vRandom.y * 50.0;
          float shimmer = sin(shimmerPhase) * cos(shimmerPhase * 0.8 + vRandom.x * 10.0);
          shimmer = shimmer * 0.5 + 0.5; // Map to 0-1
          
          // Deep, pronounced slow pulse for the 90% moody purples
          float deepPulse = (sin(uTime * 1.5 + vRandom.z * 20.0) * 0.5 + 0.5);
          
          // Interpolate the glow logic based on whether it's a shiny star or a moody purple
          float idleGlow = mix(
            1.2 + deepPulse * 0.6,   // Moody purples: deep, highly pronounced pulsing glow
            1.5 + shimmer * 1.4,     // Shiny stars: brighter, gentle but captivating rapid shimmer
            effectiveShiny
          );
          
          // Add a modest volume boost to the brightness to avoid white-out
          float brightnessBoost = idleGlow + (uVolume * 1.0);
          
          vec3 glowColor = vColor * brightnessBoost;
          
          gl_FragColor = vec4(glowColor, alpha * 0.95);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);

    let sessionCloseFunc: (() => void) | null = null;
    let dataArray: Uint8Array | null = null;
    
    // Teleprompter Sync Variables
    let turnWords: string[] = [];
    let turnStartTime = 0;
    let turnAudioDuration = 0;
    let nextStartTime = 0;
    let previousStateKey = "";

    const setupLiveAPI = async () => {
      try {
        setStatus('Waking up Audio context...');
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        
        const inputAudioContext = new AudioContextClass({ sampleRate: 16000 });
        inputAudioCtxRef.current = inputAudioContext;
        
        const outputAudioContext = new AudioContextClass({ sampleRate: 24000 });
        outputAudioCtxRef.current = outputAudioContext;

        if (inputAudioContext.state === 'suspended') await inputAudioContext.resume();
        if (outputAudioContext.state === 'suspended') await outputAudioContext.resume();

        setStatus('Requesting Microphone...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        streamRef.current = stream;

        setStatus('Connecting to Gemini Live API...');
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const outputNode = outputAudioContext.createGain();
        outputNode.connect(outputAudioContext.destination);

        const analyser = outputAudioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;
        outputNode.connect(analyser);
        analyserRef.current = analyser;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        const sessionPromise = ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-12-2025',
          callbacks: {
            onopen: () => {
              setStatus('Connected. Speak to the AI.');
              const source = inputAudioContext.createMediaStreamSource(stream);
              const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
              
              scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                sessionPromise.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                }).catch(() => {});
              };
              source.connect(scriptProcessor);
              scriptProcessor.connect(inputAudioContext.destination);
            },
            onmessage: async (message: LiveServerMessage) => {
              
              if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text.trim();
                if (text) {
                  const newWords = text.split(/\s+/).filter(w => w.length > 0);
                  turnWords.push(...newWords);
                }
              }

              const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (base64Audio) {
                try {
                  const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
                  
                  if (nextStartTime === 0 || nextStartTime < outputAudioContext.currentTime) {
                    if (turnAudioDuration === 0) {
                      turnStartTime = outputAudioContext.currentTime;
                      nextStartTime = outputAudioContext.currentTime;
                    } else {
                      const gap = outputAudioContext.currentTime - nextStartTime;
                      if (gap > 0) turnStartTime += gap;
                      nextStartTime = outputAudioContext.currentTime;
                    }
                  }

                  const source = outputAudioContext.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(outputNode);
                  
                  source.addEventListener('ended', () => {
                    sourcesRef.current.delete(source);
                  });
                  source.start(nextStartTime);
                  nextStartTime += audioBuffer.duration;
                  sourcesRef.current.add(source);
                  
                  turnAudioDuration += audioBuffer.duration;
                } catch(e) {
                  console.error("Audio playback error", e);
                }
              }

              if (message.serverContent?.interrupted) {
                turnWords = [];
                turnAudioDuration = 0;
                turnStartTime = 0;
                previousStateKey = '';
                setKineticText({ words: [], activeIndex: -1 });
                for (const source of sourcesRef.current.values()) {
                  source.stop();
                  sourcesRef.current.delete(source);
                }
                nextStartTime = 0;
              }
            },
            onerror: (e: ErrorEvent) => {
              console.error('AI Live Error:', e);
              setStatus('Connection Error.');
            },
            onclose: () => {
              setStatus('Disconnected.');
            }
          },
          config: {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {}, 
            systemInstruction: 'You are a cosmic, glowing sentient galaxy. Speak naturally in a conversational tone. Keep your sentences punchy.',
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
            }
          }
        });

        sessionCloseFunc = () => {
          sessionPromise.then(s => s.close()).catch(console.error);
        };
      } catch (err: any) {
        console.error("Setup failed:", err);
        setStatus(`Error: ${err.message || 'Check console'}`);
      }
    };

    setupLiveAPI();

    let animationFrameId: number;
    const clock = new THREE.Clock();

    const render = () => {
      animationFrameId = requestAnimationFrame(render);
      const delta = Math.min(clock.getDelta(), 0.1); 
      const time = clock.getElapsedTime();

      uniforms.uTime.value = time;

      let currentVolume = 0;
      if (analyserRef.current && dataArray) {
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) { sum += dataArray[i]; }
        const avgVolume = sum / dataArray.length;

        const noiseGate = 3; 
        const maxVol = 60; 

        if (avgVolume > noiseGate) {
          currentVolume = (avgVolume - noiseGate) / (maxVol - noiseGate);
          currentVolume = Math.min(1.0, Math.max(0.0, currentVolume));
        }
      }
      
      const lerpSpeed = currentVolume > uniforms.uVolume.value ? 16.0 : 4.0;
      uniforms.uVolume.value += (currentVolume - uniforms.uVolume.value) * lerpSpeed * delta;

      const isPlaying = sourcesRef.current.size > 0;
      
      if (isPlaying) {
         if (turnAudioDuration > 0 && outputAudioCtxRef.current && turnWords.length > 0) {
             let elapsed = outputAudioCtxRef.current.currentTime - turnStartTime;
             elapsed = Math.max(0, Math.min(elapsed, turnAudioDuration));

             const rawWps = turnWords.length / Math.max(0.1, turnAudioDuration);
             const smoothedWps = Math.min(Math.max(rawWps, 2.0), 6.0); 
             
             let activeWordAbsolute = Math.floor(elapsed * smoothedWps);
             activeWordAbsolute = Math.min(activeWordAbsolute, turnWords.length - 1);
             
             if (activeWordAbsolute >= 0) {
                 const CHUNK_SIZE = 5;
                 const chunkIndex = Math.floor(activeWordAbsolute / CHUNK_SIZE);
                 const activeWordIndexInChunk = activeWordAbsolute % CHUNK_SIZE;
                 
                 const chunkWords = turnWords.slice(chunkIndex * CHUNK_SIZE, (chunkIndex + 1) * CHUNK_SIZE);
                 
                 const stateKey = `${chunkIndex}-${activeWordIndexInChunk}`;
                 if (stateKey !== previousStateKey) {
                     previousStateKey = stateKey;
                     // Sync exactly with the React state
                     setKineticText({ words: chunkWords, activeIndex: activeWordIndexInChunk });
                 }
             }
         }

         if (!aiWasPlayingRef.current) {
             aiWasPlayingRef.current = true;
             setStatus('AI is speaking...');
             if (clearTextTimeoutRef.current) {
                 window.clearTimeout(clearTextTimeoutRef.current);
                 clearTextTimeoutRef.current = null;
             }
         }
      } else if (!isPlaying && aiWasPlayingRef.current) {
         aiWasPlayingRef.current = false;
         setStatus('Listening...');
         
         // Settle final word color state
         if (turnWords.length > 0) {
             const CHUNK_SIZE = 5;
             const chunkIndex = Math.floor((turnWords.length - 1) / CHUNK_SIZE);
             const finalWordIndexInChunk = (turnWords.length - 1) % CHUNK_SIZE;
             const chunkWords = turnWords.slice(chunkIndex * CHUNK_SIZE, (chunkIndex + 1) * CHUNK_SIZE);
             
             const stateKey = `${chunkIndex}-${finalWordIndexInChunk}`;
             if (stateKey !== previousStateKey) {
                 previousStateKey = stateKey;
                 setKineticText({ words: chunkWords, activeIndex: finalWordIndexInChunk });
             }
         }
         
         clearTextTimeoutRef.current = window.setTimeout(() => {
             if (sourcesRef.current.size === 0) {
                 turnWords = [];
                 turnAudioDuration = 0;
                 turnStartTime = 0;
                 previousStateKey = '';
                 setKineticText({ words: [], activeIndex: -1 });
             }
         }, 3500);
      } else if (!isPlaying && status !== 'Listening...' && status.includes('Connected')) {
         setStatus('Listening...');
      }

      renderer.render(scene, camera);
    };

    render();

    const handleResize = () => {
      if (!containerRef.current) return;
      width = containerRef.current.clientWidth || window.innerWidth;
      height = containerRef.current.clientHeight || window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      
      if (clearTextTimeoutRef.current) window.clearTimeout(clearTextTimeoutRef.current);
      if (sessionCloseFunc) sessionCloseFunc();
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
      if (inputAudioCtxRef.current && inputAudioCtxRef.current.state !== 'closed') inputAudioCtxRef.current.close();
      if (outputAudioCtxRef.current && outputAudioCtxRef.current.state !== 'closed') outputAudioCtxRef.current.close();

      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (containerRef.current && containerRef.current.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-[#050510]">
      {/* 3D Galaxy Canvas */}
      <div ref={containerRef} className="absolute top-0 left-0 w-full h-full" />
      
      {/* Razor-Sharp HTML Typography Overlay */}
      {kineticText.words.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-8 z-20">
          <div className="flex flex-wrap justify-center items-center gap-x-5 gap-y-4 max-w-6xl">
            {kineticText.words.map((word, i) => {
              const isActive = i === kineticText.activeIndex;
              const isSpoken = i < kineticText.activeIndex;
              
              return (
                <span
                  key={`${word}-${i}`}
                  className={`font-black uppercase text-[9vw] md:text-[120px] leading-none tracking-tighter transition-all duration-75 ease-out ${
                    isActive 
                      ? 'text-[#FFD54F] scale-110 z-10 opacity-100' // Warm amber / soft gold
                      : isSpoken 
                        ? 'text-[#87CEEB] scale-100 opacity-90' // Soft sky blue
                        : 'text-[#87CEEB] scale-95 opacity-40' // Translucent sky blue for upcoming words
                  }`}
                  style={{ 
                    fontFamily: '"Pixelify Sans", sans-serif',
                    // Heavy drop shadow for perfect readability over dark backgrounds
                    textShadow: '0px 12px 35px rgba(0,0,0,1), 0px 5px 15px rgba(0,0,0,0.9), 0px 0px 10px rgba(0,0,0,0.8)'
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* HUD / Status Overlay */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex flex-col items-center pointer-events-none z-30">
        <div className="flex items-center gap-3 bg-[#0a0a1a]/80 backdrop-blur-md px-6 py-3 rounded-full border border-[#2a1a3a]/60 shadow-[0_0_20px_rgba(0,0,0,0.8)]">
          <div className={`w-3 h-3 rounded-full ${
            status.includes('Listening') ? 'bg-purple-500 animate-pulse' : 
            status.includes('speaking') ? 'bg-[#FFD54F] animate-bounce' : 
            status.includes('Error') ? 'bg-red-500' : 'bg-gray-400 animate-pulse'
          }`}></div>
          <p className="text-[#F8F9FA] font-mono text-sm uppercase tracking-widest whitespace-nowrap">
            {status}
          </p>
        </div>
      </div>
    </div>
  );
}
